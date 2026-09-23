import { Injectable, Logger } from '@nestjs/common';
import { OutboxJob, Prisma } from '@prisma/client';

import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { generateThumbnail, resizeLogo } from '../storage/image-processor';
import { StorageService } from '../storage/storage.service';

import { EMAIL_JOB_TYPES, JOB_TYPES, MEDIA_JOB_TYPES } from './job-types.const';
import { OutboxRepository } from './outbox.repository';

// Task 1.12 (arch §13.2, ADR-13). Tunable, kept small deliberately — this is
// a lean/single-instance/demo-scale deployment (arch amendment banner), the
// pump already runs every 30s as a safety net, and a small base keeps
// integration tests (outbox.service.spec.ts) fast without needing to fake
// timers.
const MAX_ATTEMPTS = 5;
const BATCH_SIZE = 20;
const BASE_BACKOFF_MS = 100;

function computeBackoffMs(attempts: number): number {
  return BASE_BACKOFF_MS * 2 ** attempts;
}

@Injectable()
export class OutboxService {
  private readonly logger = new Logger(OutboxService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly outboxRepository: OutboxRepository,
    private readonly mailService: MailService,
    private readonly storageService: StorageService,
  ) {}

  /**
   * Must be called INSIDE the caller's own `$transaction`, never after
   * commit (arch §13.2): the job row commits atomically with the business
   * row it belongs to, or — if the caller's transaction rolls back — not at
   * all. There is nothing to un-send.
   */
  async enqueue(tx: Prisma.TransactionClient, type: string, payload: Prisma.InputJsonValue): Promise<void> {
    await this.outboxRepository.enqueue(tx, type, payload);
  }

  /**
   * Processes one bounded batch inside a single transaction (so the claim's
   * row locks stay held through dispatch + status update — see
   * OutboxRepository.claimBatch). Returns the number of jobs processed.
   */
  async drainOnce(): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      const jobs = await this.outboxRepository.claimBatch(tx, BATCH_SIZE);

      for (const job of jobs) {
        await this.processJob(tx, job);
      }

      return jobs.length;
    });
  }

  private async processJob(tx: Prisma.TransactionClient, job: OutboxJob): Promise<void> {
    try {
      await this.dispatch(job);
      await this.outboxRepository.markDone(tx, job.id);
    } catch (error) {
      const attempts = job.attempts + 1;
      const message = error instanceof Error ? error.message : String(error);

      if (attempts >= MAX_ATTEMPTS) {
        this.logger.error(
          `Outbox job ${job.id} (${job.type}) failed permanently after ${attempts} attempts: ${message}`,
        );
        await this.outboxRepository.markFailed(tx, job.id, attempts, message);
        return;
      }

      const nextAttemptAt = new Date(Date.now() + computeBackoffMs(attempts));
      this.logger.warn(
        `Outbox job ${job.id} (${job.type}) attempt ${attempts} failed, retrying at ${nextAttemptAt.toISOString()}: ${message}`,
      );
      await this.outboxRepository.markRetry(tx, job.id, attempts, nextAttemptAt, message);
    }
  }

  private async dispatch(job: OutboxJob): Promise<void> {
    if (EMAIL_JOB_TYPES.has(job.type as (typeof JOB_TYPES)[keyof typeof JOB_TYPES])) {
      return this.dispatchEmail(job);
    }
    if (MEDIA_JOB_TYPES.has(job.type as (typeof JOB_TYPES)[keyof typeof JOB_TYPES])) {
      return this.dispatchMedia(job);
    }
    throw new Error(`Unknown outbox job type: ${job.type}`);
  }

  private async dispatchEmail(job: OutboxJob): Promise<void> {
    const payload = job.payload as { to?: string; subject?: string; templateData?: Record<string, unknown> } | null;
    if (!payload?.to || !payload?.subject) {
      throw new Error(`Outbox job ${job.id} (${job.type}) payload missing required "to"/"subject"`);
    }
    await this.mailService.send({
      to: payload.to,
      subject: payload.subject,
      templateId: job.type,
      templateData: payload.templateData,
    });
  }

  // Epic-01 scope note: no Epic-01 flow enqueues MEDIA_* yet (TrainerProfile
  // logo/PlayerProfile photo writes go straight to StorageService today) —
  // this branch exists so `dispatch()` is exhaustive over every job-types
  // constant and MEDIA_* has a defined contract (arch §13.2) ready for
  // whichever later feature enqueues it.
  private async dispatchMedia(job: OutboxJob): Promise<void> {
    const payload = job.payload as { sourceUrl?: string; targetKey?: string } | null;
    if (!payload?.sourceUrl || !payload?.targetKey) {
      throw new Error(`Outbox job ${job.id} (${job.type}) payload missing required "sourceUrl"/"targetKey"`);
    }

    const response = await fetch(payload.sourceUrl);
    const input = Buffer.from(await response.arrayBuffer());
    const resized = job.type === JOB_TYPES.MEDIA_LOGO_RESIZE ? await resizeLogo(input) : await generateThumbnail(input);

    await this.storageService.upload({ key: payload.targetKey, contentType: 'image/png', body: resized });
  }
}
