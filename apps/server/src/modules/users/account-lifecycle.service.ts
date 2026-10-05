import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma, User } from '@prisma/client';

import { DomainEventsEmitter } from '../../shared/events/domain-events.emitter';
import { buildPaginatedResponse, decodeCursor, type PaginatedResponseDto } from '../../shared/http/pagination.dto';
import { AnonymizerRegistry } from '../../shared/prisma/anonymizer.registry';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { RefreshTokenRepository } from '../auth/refresh-token.repository';

import type { DeletionLogRowDto } from './dto/deletion-log-row.dto';
import type { ListDeletionLogQueryDto } from './dto/list-deletion-log-query.dto';
import { UserDeletionLogRepository } from './user-deletion-log.repository';
import { UsersRepository } from './users.repository';

// Unusable-by-construction: not a valid argon2 hash, so PasswordService.verify
// would reject any comparison against it even if status/deletedAt checks were
// ever somehow bypassed — defense in depth for arch §11.2 point 3.
const UNUSABLE_PASSWORD_SENTINEL = 'GDPR-DELETED:UNUSABLE';

// Task 3.5, extended in Task 3.6 (reactivate) and Task 3.7 (gdprDelete).
// Owns the User account-lifecycle state machine (ACTIVE <-> INACTIVE ->
// DELETED) — distinct from UsersService, which owns profile-field edits.
// `RefreshTokenRepository` is imported directly from the auth module rather
// than via an AuthModule import: AuthModule already imports UsersModule
// (for AccountProvisioningService), so the reverse import would be
// circular. RefreshTokenRepository has no state of its own beyond the
// injected PrismaService, so registering it a second time as a UsersModule
// provider (see users.module.ts) is safe — both instances share the same
// underlying PrismaService singleton.
@Injectable()
export class AccountLifecycleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly usersRepository: UsersRepository,
    private readonly refreshTokenRepository: RefreshTokenRepository,
    private readonly userDeletionLogRepository: UserDeletionLogRepository,
    private readonly anonymizerRegistry: AnonymizerRegistry,
    private readonly domainEventsEmitter: DomainEventsEmitter,
  ) {}

  /**
   * Task 3.5 (api §3 "POST /users/:id/deactivate", FR-013/BR-011). One
   * transaction: status -> INACTIVE, tokenVersion++, every RefreshToken
   * revoked. `deletedAt` is deliberately NOT touched: it is the soft-delete
   * column and belongs to GDPR delete only. Setting it here (the original
   * behaviour) hid deactivated users from the directory, from login (so the
   * client never saw ACCOUNT_INACTIVE) and from the Super Admin's own edit /
   * reactivate flows. INACTIVE is expressed by `status` alone.
   */
  async deactivate(id: string): Promise<User> {
    const user = await this.usersRepository.findByIdWithDeleted(id);
    if (!user) {
      throw new NotFoundException({ message: 'User not found', errorCode: 'NOT_FOUND' });
    }
    if (user.status !== 'ACTIVE') {
      throw new ConflictException({ message: 'User is already inactive or deleted', errorCode: 'CONFLICT' });
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await this.usersRepository.update(
        id,
        { status: 'INACTIVE', tokenVersion: { increment: 1 } },
        tx,
      );
      await this.refreshTokenRepository.revokeAllForUser(id, tx);
      return updated;
    });
  }

  /**
   * GET /users/deletion-log (Super Admin). Read-only keyset page over
   * audit."UserDeletionLog": who was erased, by whom, why, when.
   */
  async listDeletionLog(query: ListDeletionLogQueryDto): Promise<PaginatedResponseDto<DeletionLogRowDto>> {
    const limit = query.limit ?? 50;
    const cursor = query.cursor ? decodeCursor(query.cursor) : undefined;

    const rows = await this.userDeletionLogRepository.list({ limit, cursor });
    const page = buildPaginatedResponse(rows, limit, (r) => ({ createdAt: r.deletedAt.toISOString(), id: r.id }));

    return {
      ...page,
      items: page.items.map((r) => ({
        id: r.id,
        originalUserId: r.originalUserId,
        originalEmail: r.originalEmail,
        deletedBy: r.deletedByUserId,
        reason: r.reason,
        deletedAt: r.deletedAt,
      })),
    };
  }

  /**
   * Task 3.6 (api §3 "POST /users/:id/reactivate"). Hard-rejects a
   * `DELETED` target — irreversibility is structural by construction: this
   * is the only write path that could ever flip status away from DELETED,
   * and it refuses to. (The Task 1.2 DB CHECK, `status != 'DELETED' OR
   * deletedAt IS NOT NULL`, backstops the *other* direction — it cannot by
   * itself forbid DELETED -> ACTIVE, since that transition leaves the
   * CHECK's precondition false; a trigger would be needed for a literal
   * DB-level bypass guard, which Task 3.6's file list doesn't call for.)
   * No tokenVersion bump on the way back in — deactivate() already revoked
   * every RefreshToken, so "restores login" means a fresh POST /auth/login,
   * not a resurrected session.
   */
  async reactivate(id: string): Promise<User> {
    const user = await this.usersRepository.findByIdWithDeleted(id);
    if (!user) {
      throw new NotFoundException({ message: 'User not found', errorCode: 'NOT_FOUND' });
    }
    if (user.status === 'DELETED') {
      throw new ConflictException({
        message: 'Cannot reactivate a GDPR-deleted user',
        errorCode: 'CANNOT_REACTIVATE_DELETED_USER',
      });
    }
    if (user.status === 'ACTIVE') {
      throw new ConflictException({ message: 'User is already active', errorCode: 'CONFLICT' });
    }

    return this.usersRepository.update(id, { status: 'ACTIVE', deletedAt: null });
  }

  /**
   * Task 3.7 (api §3 "DELETE /users/:id", FR-014/SEC-005, arch §11.2). One
   * transaction, in the order the architecture doc specifies:
   *   1. Snapshot the pre-anonymization row to the write-only `audit`
   *      schema (UserDeletionLogRepository) — done FIRST, before anything
   *      is overwritten, so the backup is the true "before" state.
   *   2. Invoke every registered Anonymizer (AnonymizerRegistry — ordering
   *      across anonymizers is irrelevant, arch §11.2 point 2).
   *   3. The User row itself: status -> DELETED, deletedAt -> now,
   *      tokenVersion++, passwordHash -> an unusable sentinel. (The
   *      firstName/lastName/email/phone/photoUrl anonymization already
   *      happened in step 2 via UsersAnonymizer — this step only touches
   *      the lifecycle/security columns UsersAnonymizer deliberately
   *      leaves alone, per that class's own comment.)
   *   4. Revoke every RefreshToken.
   *   5. Emit `user.deleted` (DomainEventsEmitter) — nothing subscribes
   *      yet, per the plan's own note.
   */
  async gdprDelete(id: string, reason: string, deletedByUserId: string): Promise<User> {
    const user = await this.usersRepository.findByIdWithDeleted(id);
    if (!user) {
      throw new NotFoundException({ message: 'User not found', errorCode: 'NOT_FOUND' });
    }
    if (user.status === 'DELETED') {
      throw new ConflictException({ message: 'User is already deleted', errorCode: 'CONFLICT' });
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      await this.userDeletionLogRepository.create(
        {
          originalUserId: user.id,
          originalEmail: user.email,
          deletedByUserId,
          reason,
          dataBackupJson: {
            ...(user as unknown as Record<string, unknown>),
            // Pre-anonymization profile rows + associations (taken before any anonymizer runs).
            profiles: await this.userDeletionLogRepository.snapshotProfiles(user.id, tx),
          } as unknown as Prisma.InputJsonValue,
        },
        tx,
      );

      for (const anonymizer of this.anonymizerRegistry.findAll()) {
        await anonymizer.anonymize(user.id, tx);
      }

      const afterLifecycleFields = await this.usersRepository.update(
        id,
        {
          status: 'DELETED',
          deletedAt: new Date(),
          tokenVersion: { increment: 1 },
          passwordHash: UNUSABLE_PASSWORD_SENTINEL,
        },
        tx,
      );

      await this.refreshTokenRepository.revokeAllForUser(id, tx);

      return afterLifecycleFields;
    });

    this.domainEventsEmitter.emit('user.deleted', { userId: id });

    return updated;
  }
}
