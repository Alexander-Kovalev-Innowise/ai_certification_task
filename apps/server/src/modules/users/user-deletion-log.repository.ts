import { Injectable } from '@nestjs/common';
import type { Prisma, UserDeletionLog } from '@prisma/client';

import type { KeysetCursor } from '../../shared/http/pagination.dto';
import { PrismaService } from '../../shared/prisma/prisma.service';

export interface ListDeletionLogParams {
  limit: number;
  cursor?: KeysetCursor;
}

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

  /**
   * Read-only keyset page (`deletedAt`, `id`) DESC for GET /users/deletion-log.
   * Needs SELECT on audit."UserDeletionLog" — granted (and only SELECT, never
   * UPDATE/DELETE) by migration audit_tables_and_inactive_users_fix. Fetches
   * `limit + 1` rows for `buildPaginatedResponse`. `dataBackupJson` is not
   * selected.
   */
  async list(params: ListDeletionLogParams): Promise<Omit<UserDeletionLog, 'dataBackupJson'>[]> {
    const where: Prisma.UserDeletionLogWhereInput = params.cursor
      ? {
          OR: [
            { deletedAt: { lt: new Date(params.cursor.createdAt) } },
            { deletedAt: new Date(params.cursor.createdAt), id: { lt: params.cursor.id } },
          ],
        }
      : {};

    return this.prisma.userDeletionLog.findMany({
      where,
      select: { id: true, originalUserId: true, originalEmail: true, deletedByUserId: true, reason: true, deletedAt: true },
      orderBy: [{ deletedAt: 'desc' }, { id: 'desc' }],
      take: params.limit + 1,
    });
  }

  /**
   * The user's profile rows (trainer / coach / player profiles they own or
   * log into) and the associations hanging off them, read inside the
   * deletion transaction BEFORE any anonymizer runs, so the audit backup is
   * the true "before" state of everything the anonymizers are about to scrub.
   */
  async snapshotProfiles(userId: string, tx: Prisma.TransactionClient): Promise<Record<string, unknown>> {
    const [trainerProfile, coachProfile, playerProfiles] = await Promise.all([
      tx.trainerProfile.findUnique({ where: { userId } }),
      tx.coachProfile.findUnique({ where: { userId } }),
      tx.playerProfile.findMany({ where: { OR: [{ accountUserId: userId }, { childUserId: userId }] } }),
    ]);

    const associations = await tx.playerTrainerAssociation.findMany({
      where: {
        OR: [
          { playerProfileId: { in: playerProfiles.map((p) => p.id) } },
          ...(trainerProfile ? [{ trainerId: trainerProfile.id }] : []),
        ],
      },
    });

    return { trainerProfile, coachProfile, playerProfiles, associations };
  }
}
