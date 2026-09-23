import { Injectable } from '@nestjs/common';
import type { ApprovalStatus, ChildPurchaseApproval, Prisma, User } from '@prisma/client';

import type { KeysetCursor } from '../../shared/http/pagination.dto';
import { PrismaService } from '../../shared/prisma/prisma.service';

export type ApprovalWithPlayerName = ChildPurchaseApproval & { playerProfile: { name: string } };

// Task 5.13 — the shape `approve`/`deny`/`ApprovalExpiryJob` need to resolve
// who to notify: the guardian (`parent`, the model's own FK) and, when the
// profile has one, the child's own separate login (`playerProfile.childLogin`).
export type ApprovalWithNotifyTargets = ChildPurchaseApproval & {
  parent: User;
  playerProfile: { name: string; childLogin: User | null };
};

export interface ListForParentParams {
  parentUserId: string;
  status?: ApprovalStatus;
  limit: number;
  cursor?: KeysetCursor;
}

// Task 5.12, extended in Task 5.13 (approve/deny/expiry sweep).
// `ChildPurchaseApproval` is not one of the five tenant-owned models and
// carries no `deletedAt` — every query here uses the base client.
@Injectable()
export class ChildApprovalsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: Prisma.ChildPurchaseApprovalCreateInput, tx?: Prisma.TransactionClient): Promise<ChildPurchaseApproval> {
    const client = tx ?? this.prisma;
    return client.childPurchaseApproval.create({ data });
  }

  async findById(id: string, tx?: Prisma.TransactionClient): Promise<ApprovalWithPlayerName | null> {
    const client = tx ?? this.prisma;
    return client.childPurchaseApproval.findUnique({ where: { id }, include: { playerProfile: { select: { name: true } } } });
  }

  /** Task 5.13 — `approve`/`deny`/`ApprovalExpiryJob`'s read, with the guardian and (if any) the child's own login included for notification. */
  async findByIdWithNotifyTargets(id: string, tx?: Prisma.TransactionClient): Promise<ApprovalWithNotifyTargets | null> {
    const client = tx ?? this.prisma;
    return client.childPurchaseApproval.findUnique({
      where: { id },
      include: { parent: true, playerProfile: { select: { name: true, childLogin: true } } },
    });
  }

  /**
   * Task 5.13 (arch §9.3). Race-safe conditional transition — matches on
   * `status = 'PENDING'` so a concurrent resolver (a human approve/deny, or
   * `ApprovalExpiryJob`'s own sweep) can never double-transition the same
   * row; `result.count === 0` means someone else won the race.
   */
  async transitionIfPending(
    id: string,
    data: Prisma.ChildPurchaseApprovalUpdateManyMutationInput,
    tx?: Prisma.TransactionClient,
  ): Promise<{ count: number }> {
    const client = tx ?? this.prisma;
    return client.childPurchaseApproval.updateMany({ where: { id, status: 'PENDING' }, data });
  }

  /** Task 5.13 — `ApprovalExpiryJob`'s sweep target list: still-`PENDING` rows whose `expiresAt` has passed. */
  async findExpiredPendingIds(now: Date): Promise<string[]> {
    const rows = await this.prisma.childPurchaseApproval.findMany({
      where: { status: 'PENDING', expiresAt: { lt: now } },
      select: { id: true },
    });
    return rows.map((row) => row.id);
  }

  /**
   * Task 5.12 (api §4.6 "GET /approvals", FR-040/FR-041). Parent's own
   * children's requests only (`parentUserId` — the model's own FK, set at
   * `createRequest` time from the guardian's user id, not derived from
   * `PlayerProfile.accountUserId` separately). Keyset pagination on
   * `(requestedAt, id)` DESC, fetching `limit + 1` rows for the caller's
   * `hasMore` computation (same convention `pagination.dto.ts`'s
   * `buildPaginatedResponse` expects).
   */
  async listForParent(params: ListForParentParams): Promise<ApprovalWithPlayerName[]> {
    const where: Prisma.ChildPurchaseApprovalWhereInput = { parentUserId: params.parentUserId };
    if (params.status) {
      where.status = params.status;
    }
    if (params.cursor) {
      where.OR = [
        { requestedAt: { lt: new Date(params.cursor.createdAt) } },
        { requestedAt: new Date(params.cursor.createdAt), id: { lt: params.cursor.id } },
      ];
    }

    return this.prisma.childPurchaseApproval.findMany({
      where,
      include: { playerProfile: { select: { name: true } } },
      orderBy: [{ requestedAt: 'desc' }, { id: 'desc' }],
      take: params.limit + 1,
    });
  }
}
