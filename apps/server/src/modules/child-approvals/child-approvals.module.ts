import { Module } from '@nestjs/common';

import { env } from '../../shared/config/config.module';
import { JobsModule } from '../../shared/jobs/jobs.module';

import { ApprovalExpiryJob } from './approval-expiry.job';
import { ChildApprovalsController } from './child-approvals.controller';
import { ChildApprovalsRepository } from './child-approvals.repository';
import { ChildPurchaseApprovalService } from './child-purchase-approval.service';

// Task 5.12, extended in Task 5.13 with `approve`/`deny`
// (ChildPurchaseApprovalService, needs `JobsModule` for `OutboxService`) and
// `ApprovalExpiryJob`, registered only when `SCHEDULER_ENABLED` — same
// single-replica-only gating convention `ShareLinkMaintenanceJob` uses
// (`ScheduleModule.forRoot()` itself is registered once, by `JobsModule`).
@Module({
  imports: [JobsModule],
  controllers: [ChildApprovalsController],
  providers: [
    ChildApprovalsRepository,
    ChildPurchaseApprovalService,
    ...(env.SCHEDULER_ENABLED ? [ApprovalExpiryJob] : []),
  ],
  exports: [ChildApprovalsRepository, ChildPurchaseApprovalService],
})
export class ChildApprovalsModule {}
