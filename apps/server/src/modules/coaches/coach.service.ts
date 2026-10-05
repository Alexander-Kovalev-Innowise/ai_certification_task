import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { CoachProfile, Prisma, ShareLink } from '@prisma/client';

import { decodeCursor, encodeCursor } from '../../shared/http/pagination.dto';
import type { KeysetCursor, PaginatedResponseDto } from '../../shared/http/pagination.dto';
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
  private readonly logger = new Logger(CoachService.name);

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
    const trainerId = this.requireTrainerId(ctx);
    const trainerProfile = await this.prisma.trainerProfile.findUniqueOrThrow({ where: { id: trainerId } });

    await this.assertEmailInvitable(trainerId, dto.email);

    const link = await this.prisma.$transaction(async (tx) => {
      // One live invite per (trainer, email): a re-invite replaces the old link.
      await this.shareLinksRepository.revokeActiveCoachInvitesForEmail(trainerId, dto.email, tx);
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

    return this.toInviteResponse(link);
  }

  /**
   * `POST /coaches/invites/:id/resend` (US-01.08). `:id` is the `ShareLink.id`
   * of a roster invite row. Revokes the old link and issues a fresh 7-day
   * `COACH_UNIQUE` link to the same email (re-sending the invite email) in one
   * transaction — the old row becomes `REVOKED` and drops off the roster, so
   * there is never a duplicate row. 404 for a link that is not this trainer's
   * COACH_UNIQUE invite; 409 `INVITE_ALREADY_ACCEPTED` for a claimed one.
   */
  async resendInvite(ctx: AuthContext, linkId: string): Promise<InviteCoachResponseDto> {
    const trainerId = this.requireTrainerId(ctx);
    const old = await this.shareLinksRepository.findByIdForTrainer(linkId, trainerId);
    if (!old || old.type !== 'COACH_UNIQUE' || !old.targetEmail) {
      throw new NotFoundException({ message: 'Invite not found', errorCode: 'NOT_FOUND' });
    }
    if (old.useCount >= 1) {
      throw new ConflictException({
        message: 'This invite was already accepted',
        errorCode: 'INVITE_ALREADY_ACCEPTED',
      });
    }
    const email = old.targetEmail;
    await this.assertEmailInvitable(trainerId, email);

    const trainerProfile = await this.prisma.trainerProfile.findUniqueOrThrow({ where: { id: trainerId } });
    const link = await this.prisma.$transaction(async (tx) => {
      await this.shareLinksRepository.revoke(old.id, tx);
      await this.shareLinksRepository.revokeActiveCoachInvitesForEmail(trainerId, email, tx);
      const created = await this.shareLinkService.generateCoachLink(ctx, email, tx);
      await this.outboxService.enqueue(
        tx,
        JOB_TYPES.EMAIL_COACH_INVITE,
        buildCoachInviteEmailPayload(email, {
          trainerBusinessName: trainerProfile.businessName,
          shareLinkCode: created.code,
        }) as unknown as Prisma.InputJsonValue,
      );
      return created;
    });
    this.outboxService.nudge();

    this.logger.log(
      JSON.stringify({ event: 'coach.invite.resent', trainerId, oldLinkId: old.id, newLinkId: link.id, by: ctx.userId }),
    );
    return this.toInviteResponse(link);
  }

  /**
   * BR-003 at INVITE time (not only at accept time): an email that already
   * belongs to an ACTIVE coach — of ANOTHER trainer (`COACH_ALREADY_ASSIGNED`)
   * or of this one (`COACH_ALREADY_ON_ROSTER`) — cannot be invited.
   */
  private async assertEmailInvitable(trainerId: string, email: string): Promise<void> {
    const existing = await this.coachesRepository.findByUserEmail(email);
    if (existing?.status !== 'ACTIVE') {
      return;
    }
    if (existing.trainerId === trainerId) {
      throw new ConflictException({
        message: 'This coach is already on your roster',
        errorCode: 'COACH_ALREADY_ON_ROSTER',
      });
    }
    throw new ConflictException({
      message: 'This coach is already assigned to another trainer',
      errorCode: 'COACH_ALREADY_ASSIGNED',
    });
  }

  /**
   * `DELETE /coaches/:id` — the trainer removes a coach from their
   * organisation (Epic §3 "Manage own organization users"). Soft: the
   * `CoachProfile` becomes `INACTIVE` (history, overrides and availability
   * stay), the coach's sessions are revoked (`tokenVersion++`, refresh tokens
   * revoked) and every later coach-side action for this trainer is refused
   * (`updateCoach` 404s on an INACTIVE profile; the tenant-claims resolver
   * stops issuing a `tid` for it). 404 (never 403) for another tenant's coach.
   */
  async removeCoach(ctx: AuthContext, id: string): Promise<void> {
    const trainerId = this.requireTrainerId(ctx);
    const coachProfile = await this.coachesRepository.findByIdForTrainer(id, trainerId);
    if (!coachProfile || coachProfile.status === 'INACTIVE') {
      throw new NotFoundException({ message: 'Coach not found', errorCode: 'NOT_FOUND' });
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.coachProfile.update({ where: { id }, data: { status: 'INACTIVE' } });
      await tx.user.update({ where: { id: coachProfile.userId }, data: { tokenVersion: { increment: 1 } } });
      await tx.refreshToken.updateMany({
        where: { userId: coachProfile.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    });

    this.logger.log(
      JSON.stringify({
        event: 'coach.removed',
        trainerId,
        coachProfileId: id,
        coachUserId: coachProfile.userId,
        previousStatus: coachProfile.status,
        removedBy: ctx.userId,
      }),
    );
  }

  private toInviteResponse(link: { id: string; code: string; expiresAt: Date | null }): InviteCoachResponseDto {
    const response = new InviteCoachResponseDto();
    response.id = link.id;
    response.shareLinkCode = link.code;
    response.expiresAt = link.expiresAt;
    response.status = 'PENDING';
    return response;
  }

  private requireTrainerId(ctx: AuthContext): string {
    if (!ctx.trainerId) {
      // Unreachable via the real route (@Roles(TRAINER) guarantees a `tid`
      // claim) — narrows the type below.
      throw new BadRequestException({ message: 'Caller has no tenant to manage coaches for', errorCode: 'VALIDATION_ERROR' });
    }
    return ctx.trainerId;
  }

  /**
   * Task 4.12 (api §4.2 "GET /trainers/:id/coaches", FR-060's "trainer can
   * view invitation status"). `assertOwnershipOrNotFound` runs BEFORE any
   * repository call (keeps a mismatched TRAINER `:id` from reaching
   * `.extended`, where the tenant-guard would 500 instead of a clean 404).
   *
   * One logical roster built from two DB sources, paged with a real keyset
   * cursor: first the `CoachProfile` rows (Accepted / Pending; removed
   * `INACTIVE` coaches are history and never listed), ordered `(joinedAt,
   * id)` DESC, then the outstanding `ShareLink(COACH_UNIQUE)` invites (no
   * account yet — Pending / Expired), ordered `(createdAt, id)` DESC. The
   * cursor is `{createdAt, id}` with the id prefixed `p:`/`i:` naming which
   * source the last returned row came from; a page that exhausts the profiles
   * is topped up from the invites, so pages are always full except the last.
   */
  async listCoaches(
    ctx: AuthContext,
    trainerId: string,
    query: ListCoachesQueryDto,
  ): Promise<PaginatedResponseDto<CoachRosterRowDto>> {
    this.assertOwnershipOrNotFound(ctx, trainerId);

    const limit = query.limit ?? 50;
    const cursor = query.cursor ? this.parseRosterCursor(query.cursor) : undefined;
    const includeInvites = query.status !== 'ACTIVE';

    const items: CoachRosterRowDto[] = [];
    let hasMore = false;
    let last: KeysetCursor | null = null;

    if (!cursor || cursor.source === 'p') {
      const profiles = await this.coachesRepository.listByTrainer(trainerId, {
        status: query.status,
        limit,
        cursor: cursor?.keyset,
      });
      for (const cp of profiles.slice(0, limit)) {
        items.push(this.toProfileRow(cp));
        last = { createdAt: cp.joinedAt.toISOString(), id: `p:${cp.id}` };
      }
      hasMore = profiles.length > limit;
    }

    if (!hasMore && includeInvites) {
      const remaining = limit - items.length;
      const liveEmails = await this.coachesRepository.listLiveEmailsByTrainer(trainerId);
      const invites = await this.shareLinksRepository.listCoachInvitesPage(trainerId, {
        limit: remaining,
        cursor: cursor?.source === 'i' ? cursor.keyset : undefined,
        excludeEmails: liveEmails,
      });
      for (const link of invites.slice(0, remaining)) {
        items.push(this.toInviteRow(link));
        last = { createdAt: link.createdAt.toISOString(), id: `i:${link.id}` };
      }
      hasMore = invites.length > remaining;
    }

    return { items, nextCursor: hasMore && last ? encodeCursor(last) : null, hasMore };
  }

  private parseRosterCursor(raw: string): { source: 'p' | 'i'; keyset: KeysetCursor } {
    try {
      const decoded = decodeCursor(raw);
      const prefix = decoded.id.slice(0, 2);
      if (prefix !== 'p:' && prefix !== 'i:') {
        throw new Error('Invalid pagination cursor');
      }
      return {
        source: prefix === 'p:' ? 'p' : 'i',
        keyset: { createdAt: decoded.createdAt, id: decoded.id.slice(2) },
      };
    } catch {
      throw new BadRequestException({
        message: 'Invalid pagination cursor',
        errorCode: 'VALIDATION_ERROR',
        details: [{ field: 'cursor', message: 'Invalid pagination cursor' }],
      });
    }
  }

  private toInviteRow(link: ShareLink): CoachRosterRowDto {
    const expired = resolveShareLinkInvalidReason(link) !== null;
    const row = new CoachRosterRowDto();
    row.id = link.id;
    row.userId = null;
    row.name = null;
    row.email = link.targetEmail!;
    row.status = expired ? 'EXPIRED' : 'PENDING';
    row.bio = undefined;
    row.joinedAt = null;
    row.expiresAt = link.expiresAt;
    row.invitationStatus = expired ? 'Expired' : 'Pending';
    return row;
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
    // A removed (INACTIVE) coach is history: neither side may act on the profile any more.
    if (!coachProfile || coachProfile.status === 'INACTIVE') {
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
