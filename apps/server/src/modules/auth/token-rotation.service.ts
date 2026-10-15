import { Injectable, UnauthorizedException } from '@nestjs/common';
import type { RefreshToken } from '@prisma/client';

import { PrismaService } from '../../shared/prisma/prisma.service';
import { UsersRepository } from '../users/users.repository';

import { RefreshTokenRepository } from './refresh-token.repository';

// Task 2.12 (arch §6.4). Folded per-task guidance ("or fold into AuthService
// if smaller than expected") into its own file anyway: rotation +
// reuse-detection is used by both /auth/refresh (Task 2.14) and indirectly
// exercised by /auth/logout's revocation path, so it earns its own service
// rather than living inside AuthController's directly-attached service.
@Injectable()
export class TokenRotationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly refreshTokenRepository: RefreshTokenRepository,
    private readonly usersRepository: UsersRepository,
  ) {}

  /** Starts a brand new rotation family (login, Task 2.13). */
  async issueNewFamily(userId: string, tokenHash: string, familyId: string, expiresAt: Date): Promise<RefreshToken> {
    return this.refreshTokenRepository.create({ userId, tokenHash, familyId, expiresAt });
  }

  /**
   * Rotates a presented refresh token: the presented row is marked
   * `revokedAt`, a new row is issued with the SAME `familyId` (arch §6.4).
   *
   * Reuse detection is a distinct code path folded into this same method
   * (not a separate public method — a caller only ever has "a presented
   * token", and whether that token turns out to be fresh or already-revoked
   * is discovered here, not decided ahead of time): if the presented token
   * is already `revokedAt`, this is a stolen-token signal — every row
   * sharing its `familyId` is revoked and `User.tokenVersion` is bumped
   * (which also kills any still-live access token for this user, arch
   * §6.3), then this throws `401`. Both branches commit atomically.
   */
  async rotate(presentedTokenHash: string, newTokenHash: string, newExpiresAt: Date): Promise<RefreshToken> {
    // Deliberately does NOT throw from inside the $transaction callback:
    // Prisma's interactive transactions roll back every write the callback
    // made once it throws, which would silently undo the very
    // revoke-the-family / bump-tokenVersion writes the reuse branch exists
    // to commit. Instead the callback always returns a tagged result, and
    // the corresponding exception is thrown AFTER the transaction has
    // committed.
    const result = await this.prisma.$transaction(async (tx) => {
      const presented = await this.refreshTokenRepository.findByTokenHash(presentedTokenHash, tx);

      if (!presented) {
        return { kind: 'not-found' } as const;
      }

      if (presented.revokedAt) {
        // Reuse of an already-revoked token — stolen-token detection.
        await this.refreshTokenRepository.revokeAllForFamily(presented.familyId, tx);
        await this.usersRepository.update(presented.userId, { tokenVersion: { increment: 1 } }, tx);
        return { kind: 'reuse' } as const;
      }

      if (presented.expiresAt.getTime() < Date.now()) {
        return { kind: 'expired' } as const;
      }

      await this.refreshTokenRepository.revoke(presented.id, tx);
      const row = await this.refreshTokenRepository.create(
        { userId: presented.userId, tokenHash: newTokenHash, familyId: presented.familyId, expiresAt: newExpiresAt },
        tx,
      );
      return { kind: 'ok', row } as const;
    });

    if (result.kind === 'ok') {
      return result.row;
    }

    const messageByKind = {
      'not-found': 'Invalid refresh token',
      reuse: 'Refresh token reuse detected',
      expired: 'Refresh token expired',
    } as const;
    throw new UnauthorizedException({ message: messageByKind[result.kind], errorCode: 'UNAUTHORIZED' });
  }
}
