import { Injectable } from '@nestjs/common';
import type { ImpersonationLog, Prisma, User } from '@prisma/client';

import type { KeysetCursor } from '../../shared/http/pagination.dto';
import { PrismaService } from '../../shared/prisma/prisma.service';

export interface CreateImpersonationLogInput {
  adminUserId: string;
  targetUserId: string;
}

export interface ListHistoryParams {
  limit: number;
  cursor?: KeysetCursor;
  adminUserId?: string;
  targetUserId?: string;
  dateFrom?: Date;
  dateTo?: Date;
}

export type ImpersonationLogWithUsers = ImpersonationLog & { admin: User; target: User };

// Task 7.1, extended in Task 7.2 (`markEnded`), Task 7.3 (`listHistory`) and
// Task 7.4 (`closeStaleSessions`). `ImpersonationLog` is not one of the five
// tenant-owned models (tenant-guard.extension.ts) and carries no
// `deletedAt` (soft-delete.extension.ts) — every query here uses the base
// client, same convention `AvailabilityRepository` documents for its own
// `Availability`/`CoachAvailabilityOverride` queries.
@Injectable()
export class ImpersonationRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: CreateImpersonationLogInput, tx?: Prisma.TransactionClient): Promise<ImpersonationLog> {
    const client = tx ?? this.prisma;
    return client.impersonationLog.create({ data });
  }

  async findById(id: string, tx?: Prisma.TransactionClient): Promise<ImpersonationLog | null> {
    const client = tx ?? this.prisma;
    return client.impersonationLog.findUnique({ where: { id } });
  }

  // Task 7.2 (api §2 "POST /impersonation/end").
  async markEnded(id: string, endedAt: Date, durationSeconds: number, tx?: Prisma.TransactionClient): Promise<ImpersonationLog> {
    const client = tx ?? this.prisma;
    return client.impersonationLog.update({ where: { id }, data: { endedAt, durationSeconds } });
  }

  /**
   * Task 7.3 (api §2 "GET /impersonation/history"). Keyset pagination on
   * `(startedAt, id)` DESC via the row-tuple-equivalent `OR` composite
   * comparison — same technique `ChildApprovalsRepository.listForParent`
   * (Task 5.13) uses for its own `(requestedAt, id)` cursor, not raw SQL:
   * unlike `UsersRepository.findAllPaginated`, nothing here needs a
   * `pg_trgm` search, so the plain query builder is enough. `admin`/`target`
   * are joined in since `ImpersonationLogResponseDto` embeds a
   * `UserSummaryDto` for each.
   */
  async listHistory(params: ListHistoryParams): Promise<ImpersonationLogWithUsers[]> {
    const where: Prisma.ImpersonationLogWhereInput = {};

    if (params.adminUserId) {
      where.adminUserId = params.adminUserId;
    }
    if (params.targetUserId) {
      where.targetUserId = params.targetUserId;
    }
    if (params.dateFrom || params.dateTo) {
      where.startedAt = {
        ...(params.dateFrom ? { gte: params.dateFrom } : {}),
        ...(params.dateTo ? { lte: params.dateTo } : {}),
      };
    }
    if (params.cursor) {
      where.OR = [
        { startedAt: { lt: new Date(params.cursor.createdAt) } },
        { startedAt: new Date(params.cursor.createdAt), id: { lt: params.cursor.id } },
      ];
    }

    return this.prisma.impersonationLog.findMany({
      where,
      include: { admin: true, target: true },
      orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
      take: params.limit + 1,
    });
  }
}
