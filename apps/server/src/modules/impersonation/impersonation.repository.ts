import { Injectable } from '@nestjs/common';
import type { ImpersonationLog, Prisma } from '@prisma/client';

import { PrismaService } from '../../shared/prisma/prisma.service';

export interface CreateImpersonationLogInput {
  adminUserId: string;
  targetUserId: string;
}

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
}
