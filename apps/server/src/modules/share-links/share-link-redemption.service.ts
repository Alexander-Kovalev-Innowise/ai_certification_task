import { BadRequestException, ConflictException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';

import { env } from '../../shared/config/config.module';
import { JOB_TYPES } from '../../shared/jobs/job-types.const';
import { OutboxService } from '../../shared/jobs/outbox.service';
import type { AccessTokenClaims } from '../../shared/security/access-token-claims.interface';
import type { AuthContext } from '../../shared/security/auth-context.interface';
import { AuthSnapshotRepository } from '../../shared/security/auth-snapshot.repository';
import { AssociationsRepository } from '../associations/associations.repository';
import { AuthService } from '../auth/auth.service';
import type { AuthSessionResponseDto } from '../auth/dto/auth-session-response.dto';
import { PasswordService } from '../auth/password.service';
import { AccountProvisioningService } from '../users/account-provisioning.service';

import type { RedeemShareLinkDto } from './dto/redeem-share-link.dto';
import { resolveShareLinkInvalidReason } from './share-link.service';
import { ShareLinksRepository, ShareLinkWithTrainer } from './share-links.repository';

class ShareLinkUnavailableError extends ConflictException {
  constructor() {
    super({ message: 'This ShareLink is no longer available', errorCode: 'SHARE_LINK_UNAVAILABLE' });
  }
}

/**
 * `RedeemShareLinkDto`'s ANONYMOUS_REGISTRATION shape (api §4.4, reproduced
 * verbatim from the spec) carries only `playerName` — there is no separate
 * first/last name field for the *registering adult*, even though `User`
 * requires both (NOT NULL) and the adult is not always the player
 * (`isSelf: false` registers a child, whose name is not the parent's). This
 * is an unresolved gap in the spec itself (same category as the plan's own
 * flagged `PasswordResetToken.purpose` reuse decision, Task 1.1's header
 * note) rather than something silently guessed at: the best-effort fallback
 * here is to split whichever name the body did supply on its first space,
 * flagged for product sign-off if a dedicated adult-name field is wanted
 * later.
 */
function splitName(fullName: string): { firstName: string; lastName: string } {
  const trimmed = fullName.trim();
  const spaceIndex = trimmed.indexOf(' ');
  if (spaceIndex === -1) {
    return { firstName: trimmed, lastName: '' };
  }
  return { firstName: trimmed.slice(0, spaceIndex), lastName: trimmed.slice(spaceIndex + 1) };
}

function missingFieldError(fields: string[]): BadRequestException {
  return new BadRequestException({
    message: `Missing required field(s): ${fields.join(', ')}`,
    errorCode: 'VALIDATION_ERROR',
    details: fields.map((field) => ({ field, message: `${field} is required` })),
  });
}

// Task 4.6, extended in Task 4.7 (ASSOCIATE_EXISTING), Task 4.8
// (CHILD_SHARE_LINK_BLOCKED), Task 4.9 (COACH_ACCEPT) and Task 4.10
// (ROLE_CANNOT_REDEEM_SHARE_LINK + final dispatch/Swagger pass) — the five
// branches of `POST /share-links/:code/redeem` (api §4.4, arch §9.1), all
// living in this one service because they share one entry point and one
// piece of dispatch logic, not five.
@Injectable()
export class ShareLinkRedemptionService {
  constructor(
    private readonly shareLinksRepository: ShareLinksRepository,
    private readonly associationsRepository: AssociationsRepository,
    private readonly accountProvisioningService: AccountProvisioningService,
    private readonly passwordService: PasswordService,
    private readonly outboxService: OutboxService,
    private readonly authService: AuthService,
    private readonly jwtService: JwtService,
    private readonly authSnapshotRepository: AuthSnapshotRepository,
  ) {}

  /**
   * The canonical dispatch entry point (arch §9.1). `@Public()` at the guard
   * level (ShareLinksController) means `request.authContext` is never
   * populated by `JwtAuthGuard` for this route — auth is resolved manually
   * here via `resolveOptionalAuthContext`, exactly as the plan's Task 4.10
   * note ("auth read manually inside the handler") describes.
   */
  async redeem(code: string, dto: RedeemShareLinkDto, req: Request, res: Response): Promise<AuthSessionResponseDto> {
    const link = await this.shareLinksRepository.findByCode(code);
    if (!link) {
      throw new NotFoundException({ message: 'Unknown ShareLink code', errorCode: 'NOT_FOUND' });
    }

    const authContext = await this.resolveOptionalAuthContext(req);

    if (!authContext) {
      if (link.type === 'COACH_UNIQUE') {
        // Task 4.9.
        throw new Error('COACH_ACCEPT (anonymous) is implemented in Task 4.9');
      }
      return this.redeemAnonymousRegistration(link, dto, res);
    }

    // Task 4.8/4.7/4.9/4.10 fill in the remaining branches, dispatched by
    // `authContext.accountType`/`authContext.role` exactly as arch §9.1
    // diagrams (CHILD check first — a CHILD login's `role` is still
    // `PLAYER_PARENT`, so it must be checked ahead of the ASSOCIATE_EXISTING
    // role check below, not folded into it).
    throw new Error('Authenticated redeem branches are implemented in Tasks 4.7-4.10');
  }

  /**
   * Task 4.6 (api §4.4, arch §9.1 "ANONYMOUS_REGISTRATION"). No auth header.
   * One `$transaction` (AccountProvisioningService.createUserWithProfile's
   * own, extended via its `createProfile`/`afterCreate` hooks — Task 2.10's
   * generic design needs no changes to support this): `User(PLAYER_PARENT)`
   * + `PlayerProfile(isSelf|child per body)` + `PlayerTrainerAssociation` +
   * `ShareLink.useCount++` + `OutboxJob(EMAIL_SHARELINK_CONFIRMATION)`.
   * Response is `AuthSessionResponseDto` (auto-login) — `AuthService.issueSession`
   * runs after the transaction commits (same ordering
   * `AuthService.completeTrainerSetup` already uses for its own post-transaction
   * session issuance).
   */
  private async redeemAnonymousRegistration(
    link: ShareLinkWithTrainer,
    dto: RedeemShareLinkDto,
    res: Response,
  ): Promise<AuthSessionResponseDto> {
    const invalidReason = resolveShareLinkInvalidReason(link);
    if (invalidReason !== null) {
      throw new ShareLinkUnavailableError();
    }

    const missing: string[] = (['email', 'password', 'phone', 'playerName', 'dateOfBirth', 'gender'] as const).filter(
      (field) => dto[field] === undefined,
    );
    if (dto.isSelf === undefined) {
      missing.push('isSelf');
    }
    if (missing.length > 0) {
      throw missingFieldError(missing);
    }

    const passwordHash = await this.passwordService.hash(dto.password!);

    // Captured by `createProfile` and read back by `afterCreate` — both
    // callbacks run in the same closure, in the same transaction
    // (AccountProvisioningService.createUserWithProfile's ordering), so this
    // avoids a second round trip to re-look-up a row that isn't unique by
    // `accountUserId` alone (an account can own several PlayerProfiles —
    // itself plus any children, arch §4's model).
    let createdPlayerProfileId: string;
    const { firstName, lastName } = splitName(dto.playerName!);

    const user = await this.accountProvisioningService.createUserWithProfile({
      role: 'PLAYER_PARENT',
      email: dto.email!,
      passwordHash,
      firstName,
      lastName,
      phone: dto.phone,
      createProfile: async (tx, userId) => {
        const playerProfile = await tx.playerProfile.create({
          data: {
            accountUserId: userId,
            name: dto.playerName!,
            dateOfBirth: new Date(dto.dateOfBirth!),
            gender: dto.gender!,
            isSelf: dto.isSelf!,
          },
        });
        createdPlayerProfileId = playerProfile.id;
      },
      afterCreate: async (tx, createdUser) => {
        await this.associationsRepository.create(
          { trainerId: link.trainerId, playerProfileId: createdPlayerProfileId, shareLinkId: link.id },
          tx,
        );
        await this.shareLinksRepository.incrementUseCount(link.id, tx);
        await this.outboxService.enqueue(
          tx,
          JOB_TYPES.EMAIL_SHARELINK_CONFIRMATION,
          {
            to: createdUser.email,
            subject: `You're connected with ${link.trainer.businessName}`,
            templateData: { firstName: createdUser.firstName, trainerBusinessName: link.trainer.businessName },
          } as unknown as Prisma.InputJsonValue,
        );
      },
    });

    return this.authService.issueSession(user, res);
  }

  /**
   * Mirrors `JwtAuthGuard.canActivate`'s claim-resolution logic (same JWT
   * verify + `AuthSnapshotRepository.findForAuth` check), but tolerant of
   * "no Authorization header at all" (returns `undefined` instead of
   * throwing) — this route is `@Public()`, so the guard never runs and never
   * populates `request.authContext`. A *present but invalid/expired* token
   * still throws `401`, same as the guard would, rather than silently
   * falling back to the anonymous branch (a caller presenting a bad token
   * should see that, not be treated as if they hadn't tried to authenticate
   * at all). Impersonation claims (`act`) are deliberately not resolved
   * here — no realistic flow redeems a ShareLink while impersonating.
   */
  private async resolveOptionalAuthContext(req: Request): Promise<AuthContext | undefined> {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      return undefined;
    }
    const token = header.slice('Bearer '.length).trim();
    if (!token) {
      return undefined;
    }

    let claims: AccessTokenClaims;
    try {
      claims = await this.jwtService.verifyAsync<AccessTokenClaims>(token, { secret: env.JWT_SECRET });
    } catch {
      throw new UnauthorizedException({ message: 'Invalid or expired access token', errorCode: 'UNAUTHORIZED' });
    }

    const row = await this.authSnapshotRepository.findForAuth(claims.sub);
    if (!row || row.status !== 'ACTIVE' || claims.tv !== row.tokenVersion) {
      throw new UnauthorizedException({
        message: 'Account is inactive or session has been revoked',
        errorCode: 'ACCOUNT_INACTIVE',
      });
    }

    return {
      userId: claims.sub,
      role: claims.role,
      accountType: claims.typ,
      guardianUserId: claims.gid ?? undefined,
      trainerId: claims.tid ?? undefined,
      auditActorId: claims.sub,
    };
  }
}
