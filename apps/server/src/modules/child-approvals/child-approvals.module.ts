import { Module } from '@nestjs/common';

import { ChildApprovalsController } from './child-approvals.controller';
import { ChildApprovalsRepository } from './child-approvals.repository';
import { ChildPurchaseApprovalService } from './child-purchase-approval.service';

// Task 5.12, extended in Task 5.13 with `ApprovalExpiryJob`.
@Module({
  controllers: [ChildApprovalsController],
  providers: [ChildApprovalsRepository, ChildPurchaseApprovalService],
  exports: [ChildApprovalsRepository, ChildPurchaseApprovalService],
})
export class ChildApprovalsModule {}
