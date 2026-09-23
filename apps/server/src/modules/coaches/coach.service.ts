import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

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
}
