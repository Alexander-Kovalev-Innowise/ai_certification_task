import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { PrismaService } from '../../shared/prisma/prisma.service';

// Task 4.14 (arch §13.1 `share-links/ShareLinkMaintenanceJob`, every 15
// min). Sweeps `ACTIVE` links whose `expiresAt` has passed and marks them
// `EXPIRED` — closes the window `resolveShareLinkInvalidReason`
// (share-link.service.ts) already covers reactively (a still-`ACTIVE`,
// time-expired link is reported `EXPIRED` on preview/redemption regardless
// of whether this job has run yet), but keeps the stored `status` itself
// eventually consistent for anything that reads it directly (e.g.
// CoachService.listCoaches's roster). `PLAYER_STATIC` links have
// `expiresAt: null` (BR-006) and are structurally excluded — Prisma's `lt`
// comparison never matches `null`. Idempotent (a conditional `updateMany`,
// not read-then-write) — safe to fire on overlapping runs, consistent with
// arch §13.1's "sweeps stay idempotent" single-replica note. Registered as a
// provider only when `SCHEDULER_ENABLED` (Task 1.12's pattern) — see
// share-links.module.ts.
@Injectable()
export class ShareLinkMaintenanceJob {
  private readonly logger = new Logger(ShareLinkMaintenanceJob.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron('0 */15 * * * *')
  async markExpiredLinks(): Promise<void> {
    const { count } = await this.prisma.shareLink.updateMany({
      where: { status: 'ACTIVE', expiresAt: { lt: new Date() } },
      data: { status: 'EXPIRED' },
    });

    if (count > 0) {
      this.logger.log(`ShareLink maintenance sweep marked ${count} expired link(s)`);
    }
  }
}
