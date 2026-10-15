import { Injectable } from '@nestjs/common';
import { OutboxJob, Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class OutboxRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Must be called inside the caller's own `$transaction` — see
   * OutboxService.enqueue()'s doc comment. `tx` is required (not optional
   * and not last-with-a-default) because this method has no correct
   * standalone behavior: calling it outside a transaction would commit the
   * job row independently of the business write it's meant to be atomic
   * with, exactly the `afterCommit`-hook gap arch §13.2 says this design
   * closes.
   */
  async enqueue(tx: Prisma.TransactionClient, type: string, payload: Prisma.InputJsonValue): Promise<OutboxJob> {
    return tx.outboxJob.create({ data: { type, payload } });
  }

  /**
   * Claims up to `batchSize` PENDING, due (`nextAttemptAt <= now()`) jobs
   * using `FOR UPDATE SKIP LOCKED`, oldest-due-first. Must run inside `tx`:
   * the row locks it acquires are held only for the lifetime of that
   * transaction, so the caller (OutboxService.drainOnce) keeps the same
   * `tx` open through dispatch and the DONE/FAILED/retry status update —
   * that is what makes two concurrent drainOnce() calls unable to
   * double-process the same row (arch §13.2), without needing an
   * intermediate "claimed" status (OutboxStatus only has
   * PENDING/DONE/FAILED, Task 1.1).
   */
  async claimBatch(tx: Prisma.TransactionClient, batchSize: number): Promise<OutboxJob[]> {
    return tx.$queryRaw<OutboxJob[]>`
      SELECT * FROM "OutboxJob"
      WHERE status = 'PENDING' AND "nextAttemptAt" <= now()
      ORDER BY "nextAttemptAt" ASC
      LIMIT ${batchSize}
      FOR UPDATE SKIP LOCKED
    `;
  }

  async markDone(tx: Prisma.TransactionClient, id: string): Promise<void> {
    await tx.outboxJob.update({ where: { id }, data: { status: 'DONE' } });
  }

  async markFailed(tx: Prisma.TransactionClient, id: string, attempts: number, lastError: string): Promise<void> {
    await tx.outboxJob.update({ where: { id }, data: { status: 'FAILED', attempts, lastError } });
  }

  async markRetry(
    tx: Prisma.TransactionClient,
    id: string,
    attempts: number,
    nextAttemptAt: Date,
    lastError: string,
  ): Promise<void> {
    await tx.outboxJob.update({ where: { id }, data: { attempts, nextAttemptAt, lastError } });
  }
}
