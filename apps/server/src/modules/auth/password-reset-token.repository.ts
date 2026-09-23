import { Injectable } from '@nestjs/common';
import type { PasswordResetToken, Prisma } from '@prisma/client';

import { PrismaService } from '../../shared/prisma/prisma.service';

export type PasswordResetPurpose = 'PASSWORD_RESET' | 'TRAINER_SETUP';

export interface CreatePasswordResetTokenInput {
  userId: string;
  token: string; // hashed at rest, per schema comment
  purpose: PasswordResetPurpose;
  expiresAt: Date;
}

// Task 2.16. Backs both /auth/forgot-password + /auth/reset-password
// (purpose: PASSWORD_RESET, Tasks 2.16/2.17) and /auth/register's
// trainer-setup-link completion (purpose: TRAINER_SETUP, Task 2.20) — the
// plan's header note reuses this one model for both rather than adding a
// 16th one, disambiguated by `purpose`.
@Injectable()
export class PasswordResetTokenRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: CreatePasswordResetTokenInput, tx?: Prisma.TransactionClient): Promise<PasswordResetToken> {
    const client = tx ?? this.prisma;
    return client.passwordResetToken.create({ data: input });
  }

  async findByToken(tokenHash: string, tx?: Prisma.TransactionClient): Promise<PasswordResetToken | null> {
    const client = tx ?? this.prisma;
    return client.passwordResetToken.findFirst({ where: { token: tokenHash } });
  }

  async markUsed(id: string, tx?: Prisma.TransactionClient): Promise<void> {
    const client = tx ?? this.prisma;
    await client.passwordResetToken.update({ where: { id }, data: { usedAt: new Date() } });
  }
}
