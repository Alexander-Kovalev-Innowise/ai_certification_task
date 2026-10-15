import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';

import { env } from '../config/config.module';
import { MailModule } from '../mail/mail.module';
import { StorageModule } from '../storage/storage.module';

import { OutboxPump } from './outbox-pump';
import { OutboxRepository } from './outbox.repository';
import { OutboxService } from './outbox.service';

// Task 1.12 (arch §13.1 emergency valve). ScheduleModule.forRoot() — and the
// OutboxPump provider that relies on it — are only registered when
// SCHEDULER_ENABLED. This is the one-env-var escape hatch that lets a second
// replica be brought up today with SCHEDULER_ENABLED=false on all but one
// process and stay correct immediately, without a code change (arch §13.1;
// explicitly a stopgap, not a scaling design — see arch §21).
@Module({
  imports: [...(env.SCHEDULER_ENABLED ? [ScheduleModule.forRoot()] : []), MailModule, StorageModule],
  providers: [OutboxRepository, OutboxService, ...(env.SCHEDULER_ENABLED ? [OutboxPump] : [])],
  exports: [OutboxService],
})
export class JobsModule {}
