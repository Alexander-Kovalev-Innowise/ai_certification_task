import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { PrismaService } from '../../shared/prisma/prisma.service';

// Task 2.21 (arch §13.1). Purges expired RefreshToken/EmailVerificationToken/
// PasswordResetToken rows — pure storage hygiene, not a correctness
// mechanism (an already-expired row is already rejected by every consumer's
// own `expiresAt` check; this just stops the tables growing unbounded).
// Registered as a provider only when SCHEDULER_ENABLED (Task 1.12's
// pattern, arch §13.1's single-replica emergency valve) — see auth.module.ts.
@Injectable()
export class TokenMaintenanceJob {
  private readonly logger = new Logger(TokenMaintenanceJob.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_HOUR)
  async purgeExpiredTokens(): Promise<void> {
    const now = new Date();

    const [refreshTokens, emailVerificationTokens, passwordResetTokens] = await Promise.all([
      this.prisma.refreshToken.deleteMany({ where: { expiresAt: { lt: now } } }),
      this.prisma.emailVerificationToken.deleteMany({ where: { expiresAt: { lt: now } } }),
      this.prisma.passwordResetToken.deleteMany({ where: { expiresAt: { lt: now } } }),
    ]);

    this.logger.log(
      `Purged expired tokens: refreshToken=${refreshTokens.count} emailVerificationToken=${emailVerificationTokens.count} passwordResetToken=${passwordResetTokens.count}`,
    );
  }
}
