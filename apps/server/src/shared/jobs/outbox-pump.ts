import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { OutboxService } from './outbox.service';

// Task 1.12 (arch §13.1/§13.2). Safety net — picks up rows an after-commit
// nudge (Phase 2+, not built here) would have caught, e.g. if the process
// crashed between commit and nudge. Only ever registered as a provider when
// SCHEDULER_ENABLED (JobsModule gates it) — single-replica only, arch §13.1:
// every `@Cron` fires in every process that registers it, so a second
// replica running this unguarded would double-drain.
@Injectable()
export class OutboxPump {
  private readonly logger = new Logger(OutboxPump.name);

  constructor(private readonly outboxService: OutboxService) {}

  @Cron(CronExpression.EVERY_30_SECONDS)
  async drain(): Promise<void> {
    const processed = await this.outboxService.drainOnce();
    if (processed > 0) {
      this.logger.log(`Outbox pump processed ${processed} job(s)`);
    }
  }
}
