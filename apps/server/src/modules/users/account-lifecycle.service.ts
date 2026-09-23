import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { User } from '@prisma/client';

import { PrismaService } from '../../shared/prisma/prisma.service';
import { RefreshTokenRepository } from '../auth/refresh-token.repository';

import { UsersRepository } from './users.repository';

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
  ) {}

  /**
   * Task 3.5 (api §3 "POST /users/:id/deactivate", FR-013/BR-011). One
   * transaction: status -> INACTIVE, deletedAt -> now, tokenVersion++,
   * every RefreshToken revoked — reproduced verbatim from the api spec.
   * `deletedAt` is set even though status is INACTIVE, not DELETED (the DB
   * CHECK from Task 1.2 only requires deletedAt when status = DELETED, it
   * doesn't forbid deletedAt on INACTIVE) — this is what makes a merely
   * deactivated user invisible to the soft-delete extension's default
   * `findFirst`/`findMany` the same way a GDPR-deleted one is, while
   * remaining reactivatable (Task 3.6), unlike DELETED.
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
        { status: 'INACTIVE', deletedAt: new Date(), tokenVersion: { increment: 1 } },
        tx,
      );
      await this.refreshTokenRepository.revokeAllForUser(id, tx);
      return updated;
    });
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
}
