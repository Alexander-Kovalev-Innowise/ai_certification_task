import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';

import { env } from '../../shared/config/config.module';
import { JOB_TYPES } from '../../shared/jobs/job-types.const';
import { OutboxService } from '../../shared/jobs/outbox.service';
import { buildChildBlockedShareLinkEmailPayload } from '../../shared/mail/templates/child-blocked-sharelink.template';
import { PrismaService } from '../../shared/prisma/prisma.service';
import type { AccessTokenClaims } from '../../shared/security/access-token-claims.interface';
import type { AuthContext } from '../../shared/security/auth-context.interface';
import { AuthSnapshotRepository } from '../../shared/security/auth-snapshot.repository';
import { AssociationsRepository } from '../associations/associations.repository';
import { AuthService } from '../auth/auth.service';
import type { AuthSessionResponseDto } from '../auth/dto/auth-session-response.dto';
import { PasswordService } from '../auth/password.service';
import { AccountProvisioningService } from '../users/account-provisioning.service';
import { UsersRepository } from '../users/users.repository';

import type { RedeemShareLinkDto } from './dto/redeem-share-link.dto';
import { resolveShareLinkInvalidReason } from './share-link.service';
import { ShareLinksRepository, ShareLinkWithTrainer } from './share-links.repository';

class ShareLinkUnavailableError extends ConflictException {
  constructor() {
    super({ message: 'This ShareLink is no longer available', errorCode: 'SHARE_LINK_UNAVAILABLE' });
  }
}

// Task 4.7 (api §4.4 "ASSOCIATE_EXISTING"). No dedicated response DTO name
// in the spec (unlike ANONYMOUS_REGISTRATION's AuthSessionResponseDto) — one
// row per `subjectProfileIds` entry, `alreadyConnected` distinguishing the
// idempotent-no-op case from a freshly created association without the
// caller having to diff timestamps.
export interface AssociatedProfileResultDto {
  playerProfileId: string;
  status: 'ACTIVE';
  connectedAt: Date;
  alreadyConnected: boolean;
}

export type RedeemShareLinkResponse = AuthSessionResponseDto | AssociatedProfileResultDto[];

/**
 * Each branch returns a different HTTP status (`201` ANONYMOUS_REGISTRATION,
 * `200` ASSOCIATE_EXISTING, ...) — a single `@HttpCode()`/passthrough
 * `@Res()` return-value can't express that (NestJS's `RouterResponseController.apply`
 * re-applies the reflected/default status on top of the response whenever
 * `passthrough: true` is used, clobbering any status this service sets on
 * `res` directly — verified against `@nestjs/core`'s
 * `router-execution-context.js`). `ShareLinksController.redeemShareLink`
 * therefore takes full manual control of the response (`@Res()` without
 * `passthrough`) and sends exactly this `statusCode`/`body`.
 */
export interface RedeemResult {
  statusCode: number;
  body: RedeemShareLinkResponse;
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
    private readonly usersRepository: UsersRepository,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * The canonical dispatch entry point (arch §9.1). `@Public()` at the guard
   * level (ShareLinksController) means `request.authContext` is never
   * populated by `JwtAuthGuard` for this route — auth is resolved manually
   * here via `resolveOptionalAuthContext`, exactly as the plan's Task 4.10
   * note ("auth read manually inside the handler") describes.
   */
  async redeem(code: string, dto: RedeemShareLinkDto, req: Request, res: Response): Promise<RedeemResult> {
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
      const session = await this.redeemAnonymousRegistration(link, dto, res);
      return { statusCode: 201, body: session };
    }

    // CHILD check first (arch §9.1 diagram order) — a CHILD login's `role`
    // is still `PLAYER_PARENT` (AuthService.resolveTenantClaims), so it must
    // be checked ahead of the ASSOCIATE_EXISTING role check below, never
    // folded into it.
    if (authContext.accountType === 'CHILD') {
      await this.redeemChildBlocked(authContext, link.code);
    }

    if (authContext.role === 'PLAYER_PARENT') {
      const results = await this.redeemAssociateExisting(link, dto, authContext);
      return { statusCode: 200, body: results };
    }

    // Task 4.9/4.10 (COACH_ACCEPT authenticated case, ROLE_CANNOT_REDEEM_SHARE_LINK).
    throw new Error('COACH_ACCEPT/ROLE_CANNOT_REDEEM_SHARE_LINK are implemented in Tasks 4.9-4.10');
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
   * Task 4.7 (api §4.4, arch §9.1 "ASSOCIATE_EXISTING"). Auth, `typ: ADULT`,
   * `role: PLAYER_PARENT`. Body `{ subjectProfileIds: string[] }` (FR-021
   * checklist). Each profile must be owned by the caller — rejected with a
   * generic `NOT_FOUND` (never confirming/denying that a *different*
   * profile id exists and belongs to someone else, same existence-disclosure
   * posture as arch §8 Layer 3's tenant-isolation 404s) if not. Idempotent
   * per `(trainer, profile)`: `AssociationsRepository.associate`'s upsert
   * means an already-active pair is a no-op that still returns `200` with
   * that row (`alreadyConnected: true`), never an error.
   */
  private async redeemAssociateExisting(
    link: ShareLinkWithTrainer,
    dto: RedeemShareLinkDto,
    ctx: AuthContext,
  ): Promise<AssociatedProfileResultDto[]> {
    const invalidReason = resolveShareLinkInvalidReason(link);
    if (invalidReason !== null) {
      throw new ShareLinkUnavailableError();
    }

    if (!dto.subjectProfileIds || dto.subjectProfileIds.length === 0) {
      throw missingFieldError(['subjectProfileIds']);
    }

    const results: AssociatedProfileResultDto[] = [];
    for (const playerProfileId of dto.subjectProfileIds) {
      const profile = await this.associationsRepository.findOwnedPlayerProfile(playerProfileId, ctx.userId);
      if (!profile) {
        // Generic — does not distinguish "no such profile" from "exists but
        // isn't yours" (existence-disclosure posture, see method comment).
        throw new NotFoundException({ message: 'Player profile not found', errorCode: 'NOT_FOUND' });
      }

      const existing = await this.associationsRepository.findActive(link.trainerId, playerProfileId);
      const association = await this.associationsRepository.associate({
        trainerId: link.trainerId,
        playerProfileId,
        shareLinkId: link.id,
      });

      results.push({
        playerProfileId,
        status: 'ACTIVE',
        connectedAt: association.connectedAt,
        alreadyConnected: existing !== null,
      });
    }

    return results;
  }

  /**
   * Task 4.8 (api §4.4, arch §9.1 "CHILD_SHARE_LINK_BLOCKED", FR-052/SEC-006).
   * Body ignored. Side effect only: enqueues
   * `OutboxJob(EMAIL_CHILD_BLOCKED_SHARELINK)` to the guardian with the code
   * + "Review Registration" CTA. No association created, no partial state
   * written beyond that one job row — the single-statement `$transaction`
   * exists only because `OutboxService.enqueue` requires a
   * `Prisma.TransactionClient` (arch §13.2's "must be called INSIDE the
   * caller's own $transaction"), not because there is anything else to
   * commit atomically with it here. Always throws — the return type is
   * `never` so `redeem()`'s dispatcher needs no `return` after calling this.
   */
  private async redeemChildBlocked(ctx: AuthContext, shareLinkCode: string): Promise<never> {
    if (ctx.guardianUserId) {
      const [child, guardian] = await Promise.all([
        this.usersRepository.findById(ctx.userId),
        this.usersRepository.findById(ctx.guardianUserId),
      ]);

      if (guardian) {
        await this.prisma.$transaction(async (tx) => {
          await this.outboxService.enqueue(
            tx,
            JOB_TYPES.EMAIL_CHILD_BLOCKED_SHARELINK,
            buildChildBlockedShareLinkEmailPayload(guardian.email, {
              guardianFirstName: guardian.firstName,
              childFirstName: child?.firstName ?? '',
              shareLinkCode,
            }) as unknown as Prisma.InputJsonValue,
          );
        });
      }
    }

    throw new ForbiddenException({
      message: 'A child login cannot redeem a ShareLink',
      errorCode: 'CHILD_SHARE_LINK_BLOCKED',
    });
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
