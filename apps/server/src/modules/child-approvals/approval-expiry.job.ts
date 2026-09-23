import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';

import { JOB_TYPES } from '../../shared/jobs/job-types.const';
import { OutboxService } from '../../shared/jobs/outbox.service';
import { buildChildApprovalDecisionEmailPayload } from '../../shared/mail/templates/child-approval-decision.template';
import { PrismaService } from '../../shared/prisma/prisma.service';

import { ChildApprovalsRepository } from './child-approvals.repository';

// Task 5.13 (arch §9.3, api §4.6, FR-042). Every 5 minutes, auto-transitions
// still-`PENDING` rows past their 48-hour `expiresAt` to `EXPIRED` and
// notifies both parties — the sweep counterpart to a human's
// `approve`/`deny` (ChildPurchaseApprovalService), sharing the same
// race-safe conditional-`updateMany`-on-`status = 'PENDING'` primitive
// (`ChildApprovalsRepository.transitionIfPending`) so neither path can ever
// double-transition a row the other just resolved. Registered as a
// provider only when `SCHEDULER_ENABLED` — same single-replica-only gating
// convention `ShareLinkMaintenanceJob`/`OutboxPump` already use (see
// child-approvals.module.ts).
@Injectable()
export class ApprovalExpiryJob {
  private readonly logger = new Logger(ApprovalExpiryJob.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly childApprovalsRepository: ChildApprovalsRepository,
    private readonly outboxService: OutboxService,
  ) {}

  @Cron('0 */5 * * * *')
  async sweep(): Promise<void> {
    const candidateIds = await this.childApprovalsRepository.findExpiredPendingIds(new Date());
    if (candidateIds.length === 0) {
      return;
    }

    let transitioned = 0;
    for (const id of candidateIds) {
      if (await this.expireOne(id)) {
        transitioned += 1;
      }
    }

    if (transitioned > 0) {
      this.logger.log(`ApprovalExpiryJob sweep transitioned ${transitioned} PENDING approval(s) to EXPIRED`);
    }
  }

  /**
   * One row, one transaction: the conditional `updateMany` and its
   * notification commit together, or (if a concurrent `approve`/`deny` won
   * the race first, `result.count === 0`) nothing happens at all — no
   * notification is sent for a row this sweep didn't actually transition.
   */
  private async expireOne(id: string): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const result = await this.childApprovalsRepository.transitionIfPending(id, { status: 'EXPIRED' }, tx);
      if (result.count === 0) {
        return false;
      }

      const withTargets = await this.childApprovalsRepository.findByIdWithNotifyTargets(id, tx);
      if (withTargets) {
        const recipients = new Set<string>([withTargets.parent.email]);
        if (withTargets.playerProfile.childLogin) {
          recipients.add(withTargets.playerProfile.childLogin.email);
        }

        for (const to of recipients) {
          await this.outboxService.enqueue(
            tx,
            JOB_TYPES.EMAIL_CHILD_APPROVAL_DECISION,
            buildChildApprovalDecisionEmailPayload(to, {
              playerName: withTargets.playerProfile.name,
              amount: withTargets.amount.toString(),
              paymentType: withTargets.paymentType,
              decision: 'EXPIRED',
              parentNotes: null,
            }) as unknown as Prisma.InputJsonValue,
          );
        }
      }

      return true;
    });
  }
}
