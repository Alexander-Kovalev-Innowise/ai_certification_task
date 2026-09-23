import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { DomainEventsEmitter } from '../../shared/events/domain-events.emitter';
import { buildPaginatedResponse, decodeCursor, PaginatedResponseDto } from '../../shared/http/pagination.dto';
import { JOB_TYPES } from '../../shared/jobs/job-types.const';
import { OutboxService } from '../../shared/jobs/outbox.service';
import { buildChildApprovalDecisionEmailPayload } from '../../shared/mail/templates/child-approval-decision.template';
import { PrismaService } from '../../shared/prisma/prisma.service';
import type { AuthContext } from '../../shared/security/auth-context.interface';

import { ApprovalWithPlayerName, ChildApprovalsRepository } from './child-approvals.repository';
import { ApprovalRowDto } from './dto/approval-row.dto';
import type { ListApprovalsQueryDto } from './dto/list-approvals-query.dto';

// arch §9.3's 48-hour approval window, applied by `createRequest` when the
// caller doesn't supply its own `expiresAt`.
export const APPROVAL_EXPIRY_MS = 48 * 60 * 60 * 1000;

export interface CreateApprovalRequestInput {
  playerProfileId: string;
  parentUserId: string;
  eventId: string;
  amount: number | string;
  paymentType: 'USD' | 'TOKEN';
  expiresAt?: Date;
}

// Task 5.12, first method (`createRequest`) — extended in Task 5.13
// (`approve`/`deny`) and `ApprovalExpiryJob` (also Task 5.13). Named
// `ChildPurchaseApprovalService` per the plan's own prose (unlike
// `AssociationsService`, which needed renaming to fit the
// `<module>.service.ts` convention — this file is already
// `child-purchase-approval.service.ts`, matching the plan's file list
// verbatim).
@Injectable()
export class ChildPurchaseApprovalService {
  constructor(
    private readonly childApprovalsRepository: ChildApprovalsRepository,
    private readonly prisma: PrismaService,
    private readonly outboxService: OutboxService,
    private readonly domainEventsEmitter: DomainEventsEmitter,
  ) {}

  /**
   * Task 5.12 (arch §9.3). **Internal method only** — no public endpoint in
   * Epic-01 creates a `ChildPurchaseApproval` row; this exists purely as
   * the Epic-02 checkout forward-integration seam (INT-003) and as the seed
   * helper this phase's own approve/deny/expiry tests use to create
   * `PENDING` rows without a real checkout flow. Defaults `expiresAt` to
   * "now + 48h" (arch §9.3's state machine) when the caller doesn't supply
   * one.
   */
  async createRequest(input: CreateApprovalRequestInput, tx?: Prisma.TransactionClient) {
    return this.childApprovalsRepository.create(
      {
        playerProfile: { connect: { id: input.playerProfileId } },
        parent: { connect: { id: input.parentUserId } },
        eventId: input.eventId,
        amount: input.amount,
        paymentType: input.paymentType,
        expiresAt: input.expiresAt ?? new Date(Date.now() + APPROVAL_EXPIRY_MS),
      },
      tx,
    );
  }

  /**
   * Task 5.12 (api §4.6 "GET /approvals", FR-040/FR-041). Parent's own
   * children's requests only — `ChildApprovalsRepository.listForParent`
   * scopes by `parentUserId` directly. CHILD tokens never reach this method
   * (`APPROVE_CHILD_PURCHASE` is in `CHILD_DENIED`).
   */
  async listApprovals(ctx: AuthContext, query: ListApprovalsQueryDto): Promise<PaginatedResponseDto<ApprovalRowDto>> {
    const limit = query.limit ?? 50;
    const cursor = query.cursor ? decodeCursor(query.cursor) : undefined;

    const rows = await this.childApprovalsRepository.listForParent({
      parentUserId: ctx.userId,
      status: query.status,
      limit,
      cursor,
    });

    const page = buildPaginatedResponse(rows, limit, (row) => ({ createdAt: row.requestedAt.toISOString(), id: row.id }));
    return { ...page, items: page.items.map((row) => toRow(row)) };
  }

  /**
   * Task 5.13 (api §4.6 "POST /approvals/:id/approve", arch §9.3).
   * Ownership-checked first (a generic `404` for "not found" and "not the
   * caller's child" alike, same existence-disclosure posture used
   * throughout this phase), then a conditional `updateMany` on
   * `status = 'PENDING'` — race-safe against `ApprovalExpiryJob`'s own
   * sweep hitting the same row concurrently; `result.count === 0` means the
   * row was already resolved/expired, reported as `409 CONFLICT`, never a
   * silent no-op or a double-transition. Emits `child-approval.approved`
   * — no charge happens here; Epic-05 subscribes to the event later (G-09).
   */
  async approve(ctx: AuthContext, id: string, notes?: string): Promise<ApprovalRowDto> {
    const existing = await this.assertOwned(ctx, id);

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await this.childApprovalsRepository.transitionIfPending(
        id,
        { status: 'APPROVED', respondedAt: new Date(), parentNotes: notes },
        tx,
      );
      if (result.count === 0) {
        throw new ConflictException({ message: 'This request has already been resolved or expired', errorCode: 'CONFLICT' });
      }
      return this.childApprovalsRepository.findById(id, tx);
    });

    this.domainEventsEmitter.emit('child-approval.approved', {
      approvalId: id,
      playerProfileId: existing.playerProfileId,
      parentUserId: existing.parentUserId,
    });

    return toRow(updated!);
  }

  /**
   * Task 5.13 (api §4.6 "POST /approvals/:id/deny"). Same ownership +
   * race-safe conditional-update shape as `approve`. Notifies the child via
   * `OutboxJob(EMAIL_CHILD_APPROVAL_DECISION)` — the profile's own login if
   * it has one (`playerProfile.childLogin`), falling back to the guardian's
   * email when the profile has no separate child login (there is nobody
   * else to notify in that case, and a silent denial would be worse UX
   * than telling the requesting parent).
   */
  async deny(ctx: AuthContext, id: string, notes?: string): Promise<ApprovalRowDto> {
    await this.assertOwned(ctx, id);

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await this.childApprovalsRepository.transitionIfPending(
        id,
        { status: 'DENIED', respondedAt: new Date(), parentNotes: notes },
        tx,
      );
      if (result.count === 0) {
        throw new ConflictException({ message: 'This request has already been resolved or expired', errorCode: 'CONFLICT' });
      }

      const withTargets = await this.childApprovalsRepository.findByIdWithNotifyTargets(id, tx);
      if (withTargets) {
        const notifyTo = withTargets.playerProfile.childLogin?.email ?? withTargets.parent.email;
        await this.outboxService.enqueue(
          tx,
          JOB_TYPES.EMAIL_CHILD_APPROVAL_DECISION,
          buildChildApprovalDecisionEmailPayload(notifyTo, {
            playerName: withTargets.playerProfile.name,
            amount: withTargets.amount.toString(),
            paymentType: withTargets.paymentType,
            decision: 'DENIED',
            parentNotes: notes ?? null,
          }) as unknown as Prisma.InputJsonValue,
        );
      }

      return this.childApprovalsRepository.findById(id, tx);
    });

    return toRow(updated!);
  }

  /** Ownership check shared by `approve`/`deny` — a generic 404 for both "unknown id" and "not the caller's child" (arch §8 Layer 3 posture, applied to family ownership). */
  private async assertOwned(ctx: AuthContext, id: string): Promise<ApprovalWithPlayerName> {
    const existing = await this.childApprovalsRepository.findById(id);
    if (!existing || existing.parentUserId !== ctx.userId) {
      throw new NotFoundException({ message: 'Approval request not found', errorCode: 'NOT_FOUND' });
    }
    return existing;
  }
}

function toRow(row: ApprovalWithPlayerName): ApprovalRowDto {
  return {
    id: row.id,
    playerProfileId: row.playerProfileId,
    playerName: row.playerProfile.name,
    eventId: row.eventId,
    amount: row.amount.toString(),
    paymentType: row.paymentType,
    status: row.status,
    requestedAt: row.requestedAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    respondedAt: row.respondedAt ? row.respondedAt.toISOString() : null,
    parentNotes: row.parentNotes,
  };
}
