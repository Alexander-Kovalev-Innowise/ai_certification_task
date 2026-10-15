import { Injectable } from '@nestjs/common';
import type { EmailVerificationToken, Prisma } from '@prisma/client';

import { PrismaService } from '../../shared/prisma/prisma.service';

export interface CreateEmailVerificationTokenInput {
  userId: string;
  token: string; // hashed at rest, per schema comment
  expiresAt: Date;
}

// Task 2.18.
@Injectable()
export class EmailVerificationTokenRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    input: CreateEmailVerificationTokenInput,
    tx?: Prisma.TransactionClient,
  ): Promise<EmailVerificationToken> {
    const client = tx ?? this.prisma;
    return client.emailVerificationToken.create({ data: input });
  }

  async findByToken(tokenHash: string, tx?: Prisma.TransactionClient): Promise<EmailVerificationToken | null> {
    const client = tx ?? this.prisma;
    return client.emailVerificationToken.findFirst({ where: { token: tokenHash } });
  }

  async markUsed(id: string, tx?: Prisma.TransactionClient): Promise<void> {
    const client = tx ?? this.prisma;
    await client.emailVerificationToken.update({ where: { id }, data: { usedAt: new Date() } });
  }

  /** resend (Task 2.18) invalidates any still-active token before issuing a fresh one. */
  async invalidateActiveForUser(userId: string, tx?: Prisma.TransactionClient): Promise<void> {
    const client = tx ?? this.prisma;
    await client.emailVerificationToken.updateMany({
      where: { userId, usedAt: null },
      data: { usedAt: new Date() },
    });
  }
}
