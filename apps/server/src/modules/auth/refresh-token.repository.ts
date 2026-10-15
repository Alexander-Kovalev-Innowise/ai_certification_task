import { Injectable } from '@nestjs/common';
import type { Prisma, RefreshToken } from '@prisma/client';

import { PrismaService } from '../../shared/prisma/prisma.service';

export interface CreateRefreshTokenInput {
  userId: string;
  tokenHash: string;
  familyId: string;
  expiresAt: Date;
}

// Task 2.12 (arch §6.4). RefreshToken has no `deletedAt` column (Task 1.5's
// soft-delete extension doesn't touch it), so plain `findUnique` on the
// unique `tokenHash` column is correct here — no findFirst-vs-findUnique
// distinction applies to this model.
@Injectable()
export class RefreshTokenRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByTokenHash(tokenHash: string, tx?: Prisma.TransactionClient): Promise<RefreshToken | null> {
    const client = tx ?? this.prisma;
    return client.refreshToken.findUnique({ where: { tokenHash } });
  }

  async create(input: CreateRefreshTokenInput, tx?: Prisma.TransactionClient): Promise<RefreshToken> {
    const client = tx ?? this.prisma;
    return client.refreshToken.create({ data: input });
  }

  async revoke(id: string, tx?: Prisma.TransactionClient): Promise<void> {
    const client = tx ?? this.prisma;
    await client.refreshToken.update({ where: { id }, data: { revokedAt: new Date() } });
  }

  /** Stolen-token detection (arch §6.4): revokes every row in the family. */
  async revokeAllForFamily(familyId: string, tx?: Prisma.TransactionClient): Promise<void> {
    const client = tx ?? this.prisma;
    await client.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** "Logout everywhere" (Task 2.15) and password reset (Task 2.17). */
  async revokeAllForUser(userId: string, tx?: Prisma.TransactionClient): Promise<void> {
    const client = tx ?? this.prisma;
    await client.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
