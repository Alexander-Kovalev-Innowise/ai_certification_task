import { Injectable } from '@nestjs/common';
import type { Prisma, UserDeletionLog } from '@prisma/client';

import { PrismaService } from '../../shared/prisma/prisma.service';

export interface CreateUserDeletionLogInput {
  originalUserId: string;
  originalEmail: string;
  deletedByUserId: string;
  reason: string;
  dataBackupJson: Prisma.InputJsonValue;
}

/**
 * Task 3.7 (arch §11.2 point 1). Writes to the `audit` Postgres schema —
 * `UserDeletionLog` is mapped there via `@@schema("audit")` (Task 1.1), so
 * this repository's `tx.userDeletionLog.create(...)` targets that schema
 * through the SAME Prisma client/connection as everything else in
 * `AccountLifecycleService.gdprDelete()`'s transaction ("the same client
 * scoped to the audit."UserDeletionLog" model" — the plan's second,
 * simpler option, versus a genuinely separate DB connection/role). The
 * write-only guarantee (INSERT allowed, SELECT/UPDATE/DELETE denied) is
 * enforced by the GRANT/REVOKE statements the Task 1.2 migration already
 * applies to the connecting role, not by which client object issues the
 * query — see migration.sql's own caveat about superuser roles bypassing
 * REVOKE in dev/test, and migration.e2e-spec.ts's non-superuser-role proof
 * of the underlying mechanism.
 */
@Injectable()
export class UserDeletionLogRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: CreateUserDeletionLogInput, tx?: Prisma.TransactionClient): Promise<UserDeletionLog> {
    const client = tx ?? this.prisma;
    return client.userDeletionLog.create({ data: input });
  }
}
