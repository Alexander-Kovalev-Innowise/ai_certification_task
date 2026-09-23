import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { buildPaginatedResponse, decodeCursor, PaginatedResponseDto } from '../../shared/http/pagination.dto';
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
  constructor(private readonly childApprovalsRepository: ChildApprovalsRepository) {}

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
