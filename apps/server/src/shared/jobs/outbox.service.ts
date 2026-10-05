import { Injectable, Logger } from '@nestjs/common';
import { OutboxJob, Prisma } from '@prisma/client';

import { env } from '../config/config.module';
import { renderMail } from '../mail/mail-renderer';
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

  /**
   * Task 9.2 DoD sweep (arch §13.2 / ADR-13) — the "in-process nudge" the
   * architecture diagram promises but Phase 1-8 never actually wired up:
   * every enqueue() call site only relied on OutboxPump's 30s cron, which
   * technically satisfies "eventually drained" but not the documented
   * "commit → nudge: drain immediately (typical latency < 100 ms)" latency.
   * Callers invoke this right after their own `$transaction(...)` resolves
   * (i.e. only once the enqueue has actually committed) — never from inside
   * the transaction itself.
   *
   * Deliberately fire-and-forget: nothing about enqueue()'s durability
   * guarantee depends on this succeeding. A missed or failed nudge (process
   * crash between commit and the next tick, a transient DB blip) is exactly
   * what the cron safety net exists to catch, so a nudge failure is logged
   * here and never thrown back at the caller whose own business transaction
   * already committed successfully.
   */
  nudge(): void {
    setImmediate(() => {
      this.drainOnce().catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(`Outbox nudge drain failed (safety-net cron will retry): ${message}`);
      });
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

  // Renders subject + HTML + plain text (+ absolute links built from
  // CLIENT_URL) from the job's templateId (= job.type) and templateData, then
  // hands the finished mail to the MailService adapter. A render failure (e.g.
  // the token a link needs is missing from the payload) throws, so the job
  // retries/fails visibly rather than sending a link-less mail. The payload
  // `subject`, when present, wins over the template's default.
  private async dispatchEmail(job: OutboxJob): Promise<void> {
    const payload = job.payload as { to?: string; subject?: string; templateData?: Record<string, unknown> } | null;
    if (!payload?.to) {
      throw new Error(`Outbox job ${job.id} (${job.type}) payload missing required "to"`);
    }
    const rendered = renderMail(job.type, payload.templateData, env.CLIENT_URL);
    await this.mailService.send({
      to: payload.to,
      subject: payload.subject || rendered.subject,
      html: rendered.html,
      text: rendered.text,
      links: rendered.links,
      templateId: job.type,
      templateData: payload.templateData,
    });
  }

  // Task 8.2 — PortalBrandingService.updateBranding enqueues
  // MEDIA_LOGO_RESIZE when a PATCH /trainers/:id/branding sets logoUrl.
  //
  // The source is read through the StorageService port by key (never fetched
  // from an arbitrary caller-supplied URL — that would be an SSRF vector), so
  // only URLs this storage adapter issued are processed; a foreign logoUrl
  // is left untouched. The output is always PNG, written back under the same
  // key with its extension forced to .png and an image/png content type, so
  // key, extension and content type can never disagree.
  private async dispatchMedia(job: OutboxJob): Promise<void> {
    const payload = job.payload as { sourceUrl?: string; targetKey?: string } | null;
    if (!payload?.sourceUrl || !payload?.targetKey) {
      throw new Error(`Outbox job ${job.id} (${job.type}) payload missing required "sourceUrl"/"targetKey"`);
    }

    const sourceKey = this.storageService.keyFromUrl(payload.sourceUrl);
    if (!sourceKey) {
      this.logger.warn(`Outbox job ${job.id} (${job.type}): ${payload.sourceUrl} is not a managed upload, skipping`);
      return;
    }

    const input = await this.storageService.read(sourceKey);
    const resized = job.type === JOB_TYPES.MEDIA_LOGO_RESIZE ? await resizeLogo(input) : await generateThumbnail(input);

    const targetKey = payload.targetKey.replace(/\.[^./]+$/, '') + '.png';
    await this.storageService.upload({ key: targetKey, contentType: 'image/png', body: resized });
  }
}
