import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

import { resetTestDatabase, startTestDatabase, stopTestDatabase, TestDatabase } from '../../../test/setup/testcontainers.setup';
import type { SendMailOptions } from '../mail/mail.service';
import { MailService } from '../mail/mail.service';
import { LocalStorageAdapter } from '../storage/adapters/local-storage.adapter';
import type { StorageService } from '../storage/storage.service';

import { JOB_TYPES } from './job-types.const';
import { OutboxRepository } from './outbox.repository';
import { OutboxService } from './outbox.service';

function fakeMailService(impl?: (options: SendMailOptions) => Promise<void>): MailService & { send: jest.Mock } {
  return { send: jest.fn(impl ?? (async () => undefined)) } as unknown as MailService & { send: jest.Mock };
}

function fakeStorageService(): StorageService {
  return { upload: jest.fn(), delete: jest.fn() } as unknown as StorageService;
}

describe('OutboxService (Task 1.12)', () => {
  jest.setTimeout(120_000);

  let db: TestDatabase;
  let outboxRepository: OutboxRepository;

  beforeAll(async () => {
    db = await startTestDatabase();
    outboxRepository = new OutboxRepository(db.prisma);
  });

  afterAll(async () => {
    await stopTestDatabase(db);
  });

  afterEach(async () => {
    await resetTestDatabase(db);
  });

  function buildService(mail: MailService = fakeMailService(), storage: StorageService = fakeStorageService()) {
    return new OutboxService(db.prisma, outboxRepository, mail, storage);
  }

  it('a business transaction that throws after enqueue() leaves no OutboxJob row', async () => {
    const service = buildService();

    await expect(
      db.prisma.$transaction(async (tx) => {
        await service.enqueue(tx, JOB_TYPES.EMAIL_VERIFICATION, { to: 'a@example.com', subject: 'Verify' });
        throw new Error('business logic failed after enqueue');
      }),
    ).rejects.toThrow('business logic failed after enqueue');

    const count = await db.prisma.outboxJob.count();
    expect(count).toBe(0);
  });

  it("a committed transaction's job is visible to drainOnce() and gets dispatched + marked DONE", async () => {
    const mail = fakeMailService();
    const service = buildService(mail);

    await db.prisma.$transaction(async (tx) => {
      await service.enqueue(tx, JOB_TYPES.EMAIL_VERIFICATION, { to: 'a@example.com', subject: 'Verify' });
    });

    const processed = await service.drainOnce();

    expect(processed).toBe(1);
    expect(mail.send).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'a@example.com', subject: 'Verify', templateId: JOB_TYPES.EMAIL_VERIFICATION }),
    );

    const job = await db.prisma.outboxJob.findFirstOrThrow();
    expect(job.status).toBe('DONE');
  });

  it('drainOnce() run twice concurrently does not double-process the same row (SKIP LOCKED)', async () => {
    // Small delay inside the mocked dispatch widens the window during which
    // the first drainOnce()'s transaction still holds the row lock, so the
    // second call's claim query actually has something to SKIP LOCKED past
    // rather than trivially finding no rows because the first already
    // committed.
    const mail = fakeMailService(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    const service = buildService(mail);

    await db.prisma.$transaction(async (tx) => {
      await service.enqueue(tx, JOB_TYPES.EMAIL_VERIFICATION, { to: 'a@example.com', subject: 'Verify' });
    });

    const [processedA, processedB] = await Promise.all([service.drainOnce(), service.drainOnce()]);

    expect(processedA + processedB).toBe(1);
    expect(mail.send).toHaveBeenCalledTimes(1);

    const job = await db.prisma.outboxJob.findFirstOrThrow();
    expect(job.status).toBe('DONE');
  });

  it('a job that fails repeatedly hits the attempts cap and lands in FAILED, not retried forever', async () => {
    const mail = fakeMailService(async () => {
      throw new Error('provider outage');
    });
    const service = buildService(mail);

    await db.prisma.$transaction(async (tx) => {
      await service.enqueue(tx, JOB_TYPES.EMAIL_VERIFICATION, { to: 'a@example.com', subject: 'Verify' });
    });

    // MAX_ATTEMPTS is 5 (outbox.service.ts) — drain, then force nextAttemptAt
    // back to "now" so the next drainOnce() doesn't have to wait out the
    // real exponential backoff, keeping this test fast and deterministic.
    for (let i = 0; i < 5; i += 1) {
      await service.drainOnce();
      await db.prisma.outboxJob.updateMany({ data: { nextAttemptAt: new Date() } });
    }

    const job = await db.prisma.outboxJob.findFirstOrThrow();
    expect(job.status).toBe('FAILED');
    expect(job.attempts).toBe(5);
    expect(job.lastError).toContain('provider outage');
    expect(mail.send).toHaveBeenCalledTimes(5);

    // A further drain must not touch the row again — it's FAILED, not PENDING.
    const processedAfterFailure = await service.drainOnce();
    expect(processedAfterFailure).toBe(0);
    expect(mail.send).toHaveBeenCalledTimes(5);
  });

  // Task 8.2 (api §4.1, "sharp resizes toward 200×200 via the
  // MEDIA_LOGO_RESIZE outbox job"). Uses the REAL LocalStorageAdapter (not
  // fakeStorageService) end to end — this is what actually exercises
  // dispatchMedia's readSource() `file://` branch (fetch() cannot read a
  // `file://` URL; LocalStorageAdapter, the default STORAGE_PROVIDER=local
  // adapter, is exactly what issues one) and proves the resize-then-upload
  // round trip, not just that upload() was called with something.
  it('draining a MEDIA_LOGO_RESIZE job reads the local-adapter file:// source, resizes it toward 200x200, and overwrites the same key', async () => {
    const storage = new LocalStorageAdapter();
    const service = buildService(fakeMailService(), storage);

    const original = await sharp({ create: { width: 800, height: 400, channels: 3, background: { r: 10, g: 20, b: 30 } } })
      .png()
      .toBuffer();
    const uploaded = await storage.upload({ key: 'logo-test.png', contentType: 'image/png', body: original });

    await db.prisma.$transaction(async (tx) => {
      await service.enqueue(tx, JOB_TYPES.MEDIA_LOGO_RESIZE, { sourceUrl: uploaded.url, targetKey: uploaded.key });
    });

    const processed = await service.drainOnce();
    expect(processed).toBe(1);

    const job = await db.prisma.outboxJob.findFirstOrThrow();
    expect(job.status).toBe('DONE');

    const resizedBytes = await readFile(fileURLToPath(uploaded.url));
    const metadata = await sharp(resizedBytes).metadata();

    // fit: 'inside' (resizeLogo, Task 1.11) — 800x400 (2:1) bounds to 200x100.
    expect(metadata.width).toBe(200);
    expect(metadata.height).toBe(100);
  });
});
