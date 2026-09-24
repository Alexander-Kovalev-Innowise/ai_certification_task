import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { CoachProfile, Prisma } from '@prisma/client';

import type { PaginatedResponseDto } from '../../shared/http/pagination.dto';
import { JOB_TYPES } from '../../shared/jobs/job-types.const';
import { OutboxService } from '../../shared/jobs/outbox.service';
import { buildCoachInviteEmailPayload } from '../../shared/mail/templates/coach-invite.template';
import { PrismaService } from '../../shared/prisma/prisma.service';
import type { AuthContext } from '../../shared/security/auth-context.interface';
import { resolveShareLinkInvalidReason } from '../share-links/share-link.service';
import { ShareLinkService } from '../share-links/share-link.service';
import { ShareLinksRepository } from '../share-links/share-links.repository';

import { CoachesRepository, CoachProfileWithUser } from './coaches.repository';
import { CoachRosterRowDto } from './dto/coach-roster-row.dto';
import type { InviteCoachDto } from './dto/invite-coach.dto';
import { InviteCoachResponseDto } from './dto/invite-coach.dto';
import type { ListCoachesQueryDto } from './dto/list-coaches-query.dto';
import { CoachProfileResponseDto, UpdateCoachDto } from './dto/update-coach.dto';

const TRAINER_ALLOWED_FIELDS: readonly (keyof UpdateCoachDto)[] = ['status'];
const COACH_ALLOWED_FIELDS: readonly (keyof UpdateCoachDto)[] = ['bio', 'credentials', 'certifications', 'publicProfile'];

// Task 4.11, first method — extended in Task 4.12 (listCoaches) and Task
// 4.13 (updateCoach).
@Injectable()
export class CoachService {
  constructor(
    private readonly shareLinkService: ShareLinkService,
    private readonly shareLinksRepository: ShareLinksRepository,
    private readonly coachesRepository: CoachesRepository,
    private readonly outboxService: OutboxService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Task 4.11 (api §4.2 "POST /coaches/invite", FR-060). Trainer only, own
   * tenant. Delegates to `ShareLinkService.generateCoachLink` (Task 4.2) for
   * the actual `ShareLink(type=COACH_UNIQUE)` row — this method's own job is
   * wrapping that call and the `OutboxJob(EMAIL_COACH_INVITE)` enqueue in
   * one `$transaction` (arch §13.2: the invite email must not fire for a
   * link that didn't actually commit), and resolving the trainer's
   * `businessName` for the email (`ctx` carries no display name of its own).
   */
  async inviteCoach(ctx: AuthContext, dto: InviteCoachDto): Promise<InviteCoachResponseDto> {
    if (!ctx.trainerId) {
      // Unreachable via the real route (@Roles(TRAINER) guarantees a `tid`
      // claim) — narrows the type below, same defensive posture as
      // ShareLinkService.requireTrainerId.
      throw new BadRequestException({ message: 'Caller has no tenant to invite a coach into', errorCode: 'VALIDATION_ERROR' });
    }
    const trainerProfile = await this.prisma.trainerProfile.findUniqueOrThrow({ where: { id: ctx.trainerId } });

    const link = await this.prisma.$transaction(async (tx) => {
      const created = await this.shareLinkService.generateCoachLink(ctx, dto.email, tx);
      await this.outboxService.enqueue(
        tx,
        JOB_TYPES.EMAIL_COACH_INVITE,
        buildCoachInviteEmailPayload(dto.email, {
          trainerBusinessName: trainerProfile.businessName,
          inviteeName: dto.name,
          message: dto.message,
          shareLinkCode: created.code,
        }) as unknown as Prisma.InputJsonValue,
      );
      return created;
    });
    this.outboxService.nudge();

    const response = new InviteCoachResponseDto();
    response.shareLinkCode = link.code;
    response.expiresAt = link.expiresAt;
    response.status = 'PENDING';
    return response;
  }

  /**
   * Task 4.12 (api §4.2 "GET /trainers/:id/coaches", FR-060's "trainer can
   * view invitation status"). `assertOwnershipOrNotFound` runs BEFORE any
   * repository call — same ordering ShareLinkService.listShareLinks
   * documents, and for the same reason (keeps a mismatched TRAINER `:id`
   * from ever reaching `.extended`, where the tenant-guard extension would
   * throw a 500 instead of a clean 404).
   *
   * Merges two sources into one roster:
   *  - `CoachProfile` rows (a real coach account exists) — `invitationStatus`
   *    is `'Accepted'` (status ACTIVE) or `'Pending'` (status PENDING, only
   *    ever reached via a trainer manually setting it back, Task 4.13).
   *  - Still-outstanding `ShareLink(COACH_UNIQUE)` invites with no matching
   *    `CoachProfile` yet — `'Pending'` (still `ACTIVE`, not time-expired) or
   *    `'Expired'` otherwise. Matched against accepted profiles by
   *    `targetEmail` so an invite that WAS successfully claimed doesn't
   *    double-count: arch §9.1's single-use claim sets a `ShareLink`'s own
   *    `status` to `'EXPIRED'` on both a successful accept and genuine
   *    time-expiry alike (there is no `CoachProfile.shareLinkId` column to
   *    disambiguate the two directly, unlike `PlayerTrainerAssociation`) —
   *    this email cross-reference is the practical workaround, flagged here
   *    as a known limitation rather than silently assumed correct: it can
   *    misclassify an already-expired, never-accepted invite as excluded if
   *    a *different, later* invite to the same email was accepted, and it
   *    entirely misses a targetEmail change between invite and account
   *    creation (not possible in this codebase today, since email is fixed
   *    at redemption, but noted for completeness).
   *
   * Pagination is a plain in-memory slice after merging both sources, not a
   * DB-level keyset query — a trainer's coach roster is a small, bounded
   * list (arch §18: "no dashboard, no aggregation" for ShareLink analytics
   * either), and a true cross-source keyset cursor over two different tables
   * with different sort keys is materially more complex for a resource this
   * size; flagged as a deliberate simplification, not an oversight.
   */
  async listCoaches(
    ctx: AuthContext,
    trainerId: string,
    query: ListCoachesQueryDto,
  ): Promise<PaginatedResponseDto<CoachRosterRowDto>> {
    this.assertOwnershipOrNotFound(ctx, trainerId);

    const coachProfiles = await this.coachesRepository.listByTrainer(trainerId, query.status);
    const acceptedEmails = new Set(coachProfiles.filter((cp) => cp.status === 'ACTIVE').map((cp) => cp.user.email));

    const profileRows = coachProfiles.map((cp) => this.toProfileRow(cp));

    let inviteRows: CoachRosterRowDto[] = [];
    if (query.status !== 'ACTIVE') {
      const invites = await this.shareLinksRepository.listCoachInvitesByTrainer(trainerId);
      inviteRows = invites
        .filter((link) => !!link.targetEmail && !acceptedEmails.has(link.targetEmail))
        .map((link) => {
          const invalidReason = resolveShareLinkInvalidReason(link);
          const row = new CoachRosterRowDto();
          row.id = link.id;
          row.userId = null;
          row.name = null;
          row.email = link.targetEmail!;
          row.status = link.status;
          row.bio = undefined;
          row.joinedAt = null;
          row.invitationStatus = invalidReason !== null ? 'Expired' : 'Pending';
          return row;
        });
    }

    const limit = query.limit ?? 50;
    const merged = [...profileRows, ...inviteRows];

    // No real cursor across two merged sources (see method comment) —
    // `nextCursor` is always `null`; `hasMore` still tells the caller
    // whether this bounded, single-page slice cut anything off.
    return { items: merged.slice(0, limit), nextCursor: null, hasMore: merged.length > limit };
  }

  private toProfileRow(cp: CoachProfileWithUser): CoachRosterRowDto {
    const row = new CoachRosterRowDto();
    row.id = cp.id;
    row.userId = cp.userId;
    row.name = `${cp.user.firstName} ${cp.user.lastName}`.trim();
    row.email = cp.user.email;
    row.status = cp.status;
    row.bio = cp.bio;
    row.joinedAt = cp.joinedAt;
    row.invitationStatus = cp.status === 'ACTIVE' ? 'Accepted' : 'Pending';
    return row;
  }

  /** Mirrors ShareLinkService's own ownership check (api §4.1 footnote) — 404, never 403 (arch §8 Layer 3). */
  private assertOwnershipOrNotFound(ctx: AuthContext, trainerId: string): void {
    if (ctx.role === 'SUPER_ADMIN') {
      return;
    }
    if (ctx.role === 'TRAINER' && ctx.trainerId === trainerId) {
      return;
    }
    throw new NotFoundException({ message: 'Trainer not found', errorCode: 'NOT_FOUND' });
  }

  /**
   * Task 4.13 (api §4.2 "PATCH /coaches/:id", dual-actor). `:id` is the
   * `CoachProfile.id`, not a `:trainerId` path param, so ownership can't be
   * checked by comparing ids directly the way `assertOwnershipOrNotFound`
   * does above — the row has to be read first.
   * `CoachesRepository.findByIdForTrainer(id, ctx.trainerId)` only proves
   * "same trainer" (both TRAINER and COACH tokens carry a `tid` for this
   * endpoint, access-token-claims.interface.ts), which is the full ownership
   * proof for a TRAINER caller but not yet for a COACH caller — the extra
   * `coachProfile.userId !== ctx.userId` check below is what closes that gap
   * for the "another coach under the same trainer" case. Both a genuinely
   * unknown id and an ownership miss produce the same generic `404`
   * (arch §8 Layer 3 existence-disclosure posture), never `403`.
   */
  async updateCoach(ctx: AuthContext, id: string, dto: UpdateCoachDto): Promise<CoachProfileResponseDto> {
    if (!ctx.trainerId) {
      throw new NotFoundException({ message: 'Coach not found', errorCode: 'NOT_FOUND' });
    }

    const coachProfile = await this.coachesRepository.findByIdForTrainer(id, ctx.trainerId);
    if (!coachProfile) {
      throw new NotFoundException({ message: 'Coach not found', errorCode: 'NOT_FOUND' });
    }

    if (ctx.role === 'TRAINER') {
      this.assertOnlyFields(dto, TRAINER_ALLOWED_FIELDS);
      const updated = await this.coachesRepository.update(id, {
        ...(dto.status !== undefined ? { status: dto.status } : {}),
      });
      return this.toProfileResponse(updated);
    }

    if (ctx.role === 'COACH') {
      if (coachProfile.userId !== ctx.userId) {
        throw new NotFoundException({ message: 'Coach not found', errorCode: 'NOT_FOUND' });
      }
      this.assertOnlyFields(dto, COACH_ALLOWED_FIELDS);
      const updated = await this.coachesRepository.update(id, {
        ...(dto.bio !== undefined ? { bio: dto.bio } : {}),
        ...(dto.credentials !== undefined ? { credentials: dto.credentials } : {}),
        ...(dto.certifications !== undefined ? { certifications: dto.certifications } : {}),
        ...(dto.publicProfile !== undefined ? { publicProfile: dto.publicProfile } : {}),
      });
      return this.toProfileResponse(updated);
    }

    // Unreachable via the real route (@Roles(TRAINER, COACH) excludes every
    // other role) — defensive fallback, not a documented response shape.
    throw new ForbiddenException({ message: 'Role cannot update a coach profile', errorCode: 'FORBIDDEN' });
  }

  /**
   * Rejects (`403 FIELD_NOT_ALLOWED_FOR_ROLE`) any field the DTO carries
   * that ISN'T in the caller's allowed set — never silently drops it (api
   * §4.2: "the service rejects... rather than silently ignoring it").
   */
  private assertOnlyFields(dto: UpdateCoachDto, allowed: readonly (keyof UpdateCoachDto)[]): void {
    const disallowed = (Object.keys(dto) as (keyof UpdateCoachDto)[]).filter(
      (field) => dto[field] !== undefined && !allowed.includes(field),
    );
    if (disallowed.length > 0) {
      throw new ForbiddenException({
        message: `Field(s) not allowed for this role: ${disallowed.join(', ')}`,
        errorCode: 'FIELD_NOT_ALLOWED_FOR_ROLE',
        details: disallowed.map((field) => ({ field, message: 'Not allowed for this role' })),
      });
    }
  }

  private toProfileResponse(cp: CoachProfile): CoachProfileResponseDto {
    const response = new CoachProfileResponseDto();
    response.id = cp.id;
    response.userId = cp.userId;
    response.trainerId = cp.trainerId;
    response.status = cp.status;
    response.bio = cp.bio;
    response.credentials = cp.credentials;
    response.certifications = cp.certifications;
    response.publicProfile = cp.publicProfile;
    return response;
  }
}
