import { randomUUID } from 'node:crypto';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { OutboxJob } from '@prisma/client';
import * as argon2 from 'argon2';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import request from 'supertest';

import type { OutboxPump } from '../src/shared/jobs/outbox-pump';
import type { OutboxService } from '../src/shared/jobs/outbox.service';

import { resetTestDatabase, startTestDatabase, stopTestDatabase, TestDatabase } from './setup/testcontainers.setup';

// Task 9.2 (arch §13.2 / §20 DoD "outbox end-to-end" sweep). Task 1.12
// planned this exact file ("outbox.service.spec.ts / outbox.e2e-spec.ts")
// but only the former was ever created — this sweep both creates it and
// fulfills its purpose: outbox.service.spec.ts already proves the
// mechanics (rollback leaves no row, SKIP LOCKED, backoff-to-FAILED,
// MEDIA_LOGO_RESIZE's file:// read) against a bare OutboxService driven by
// synthetic enqueue() calls. This file proves the SAME guarantees hold when
// the enqueue is a side effect of a real, unmodified HTTP feature endpoint
// (POST /share-links/:code/redeem's anonymous PLAYER_STATIC branch,
// EMAIL_SHARELINK_CONFIRMATION) — per the DoD item's own wording, "force a
// failure inside POST /share-links/:code/redeem's anonymous branch".
//
// Sweeping this also surfaced a real gap fixed as part of this same commit:
// arch §13.2's diagram promises "commit → in-process nudge: drain
// immediately (typical latency < 100 ms)", but no code anywhere ever called
// anything after a business transaction committed — every enqueue() site
// relied solely on OutboxPump's 30s safety-net cron. OutboxService.nudge()
// (fire-and-forget, setImmediate-scheduled) and its call sites in every
// enqueuing service now close that gap; this file's second test is what
// would have caught its absence.
describe('Outbox — end-to-end DoD sweep (Task 9.2, real feature flows)', () => {
  jest.setTimeout(180_000);

  let db: TestDatabase;
  let app: INestApplication;
  let outboxService: OutboxService;
  let outboxPump: OutboxPump;

  const originalDatabaseUrl = process.env.DATABASE_URL;
  const KNOWN_PASSWORD = 'CorrectHorseBattery1';

  beforeAll(async () => {
    db = await startTestDatabase();
    process.env.DATABASE_URL = db.connectionUri;

    // Every one of these is require()'d here, not statically imported at
    // module scope — config.module.ts captures `env.DATABASE_URL` (and thus
    // PrismaService's connection string) the FIRST time anything imports it,
    // transitively, module-load time. A static `import` of OutboxService et
    // al. at the top of this file would pull config.module.ts in before this
    // beforeAll ever runs, capturing the wrong (non-Testcontainers)
    // DATABASE_URL. Same reasoning share-links.e2e-spec.ts's own beforeAll
    // already documents for AppModule/GlobalExceptionFilter/JwtService.
    /* eslint-disable @typescript-eslint/no-require-imports -- deliberate, defers evaluation until after DATABASE_URL is set */
    const { AppModule } = require('../src/app.module') as typeof import('../src/app.module');
    const { GlobalExceptionFilter } = require('../src/shared/http/global-exception.filter') as typeof import('../src/shared/http/global-exception.filter');
    const { OutboxService: OutboxServiceCtor } = require('../src/shared/jobs/outbox.service') as typeof import('../src/shared/jobs/outbox.service');
    const { OutboxPump: OutboxPumpCtor } = require('../src/shared/jobs/outbox-pump') as typeof import('../src/shared/jobs/outbox-pump');
    /* eslint-enable @typescript-eslint/no-require-imports */

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(helmet());
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();

    // SCHEDULER_ENABLED defaults to true (shared/config/env.schema.ts), so
    // JobsModule registers a real OutboxPump — the same instance whose
    // @Cron(EVERY_30_SECONDS) fires in normal operation. Resolving it here
    // lets tests invoke its exact `drain()` handler directly instead of
    // waiting out a real 30s tick.
    outboxService = moduleRef.get(OutboxServiceCtor);
    outboxPump = moduleRef.get(OutboxPumpCtor);
  });

  afterAll(async () => {
    await app?.close();
    await stopTestDatabase(db);
    process.env.DATABASE_URL = originalDatabaseUrl;
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await resetTestDatabase(db);
  });

  async function insertTrainer(overrides: Record<string, unknown> = {}): Promise<{ userId: string; trainerId: string }> {
    const userId = randomUUID();
    await db.prisma.user.create({
      data: {
        id: userId,
        email: `${userId}@example.com`,
        passwordHash: await argon2.hash(KNOWN_PASSWORD),
        role: 'TRAINER',
        firstName: 'A',
        lastName: 'B',
        status: 'ACTIVE',
      },
    });
    const trainerId = randomUUID();
    await db.prisma.trainerProfile.create({
      data: { id: trainerId, userId, businessName: 'Outbox Sweep Co', ...overrides },
    });
    return { userId, trainerId };
  }

  async function seedPlayerStaticLink(): Promise<{ code: string; trainerId: string }> {
    const trainer = await insertTrainer();
    const link = await db.prisma.shareLink.create({
      data: { code: `outbox-sweep-${randomUUID()}`, type: 'PLAYER_STATIC', trainerId: trainer.trainerId, createdByUserId: trainer.userId },
    });
    return { code: link.code, trainerId: trainer.trainerId };
  }

  function redeemDto(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      email: `${randomUUID()}@example.com`,
      password: 'Password1',
      phone: '+14155552671',
      playerName: 'Outbox Sweep Player',
      dateOfBirth: '2015-01-01',
      gender: 'OTHER',
      isSelf: false,
      ...overrides,
    };
  }

  /**
   * The nudge is fire-and-forget (`setImmediate`), so its drain lands some
   * time after the HTTP response resolves, not necessarily before this
   * function's caller's next line. Polls briefly rather than asserting on a
   * fixed sleep — arch §13.2 documents "typical latency < 100 ms", so a 2s
   * budget is generous headroom, not a tuned-to-flake timing assumption.
   */
  async function pollForJobStatus(type: string, status: OutboxJob['status'], timeoutMs = 2000): Promise<OutboxJob> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const job = await db.prisma.outboxJob.findFirst({ where: { type } });
      if (job?.status === status) {
        return job;
      }
      if (Date.now() >= deadline) {
        throw new Error(`Timed out waiting for an OutboxJob(${type}) to reach status ${status}; last seen: ${JSON.stringify(job)}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  it('a rolled-back registration transaction leaves no OutboxJob row and sends no email', async () => {
    // AccountProvisioningService.createUserWithProfile (Task 2.10) writes
    // the User row FIRST, inside the same $transaction that later (via
    // ShareLinkRedemptionService's afterCreate) enqueues
    // EMAIL_SHARELINK_CONFIRMATION. Colliding on User.email's @@unique
    // constraint forces a real, unmodified failure of that same
    // transaction — a genuine "force a failure inside POST
    // /share-links/:code/redeem's anonymous branch", not a synthetic throw
    // injected into the service.
    const collidingEmail = `${randomUUID()}@example.com`;
    await db.prisma.user.create({
      data: {
        email: collidingEmail,
        passwordHash: await argon2.hash(KNOWN_PASSWORD),
        role: 'PLAYER_PARENT',
        firstName: 'Existing',
        lastName: 'User',
        status: 'ACTIVE',
      },
    });

    const link = await seedPlayerStaticLink();

    const res = await request(app.getHttpServer())
      .post(`/share-links/${link.code}/redeem`)
      .send(redeemDto({ email: collidingEmail }));

    expect(res.status).toBeGreaterThanOrEqual(400);

    const jobs = await db.prisma.outboxJob.findMany();
    expect(jobs).toHaveLength(0);

    // No partial write either — the rollback took the User insert attempt
    // down with it, so exactly the pre-seeded row remains.
    const matchingUsers = await db.prisma.user.count({ where: { email: collidingEmail } });
    expect(matchingUsers).toBe(1);

    const link_ = await db.prisma.shareLink.findUnique({ where: { code: link.code } });
    expect(link_?.useCount).toBe(0);
  });

  it("a committed registration's job is drained by the in-process nudge, with no manual drain call", async () => {
    const link = await seedPlayerStaticLink();

    const res = await request(app.getHttpServer()).post(`/share-links/${link.code}/redeem`).send(redeemDto());

    expect(res.status).toBe(201);

    // Deliberately never calls outboxService.drainOnce()/outboxPump.drain()
    // here — if OutboxService.nudge() regressed to a no-op, this job would
    // still be PENDING when the poll times out.
    const job = await pollForJobStatus('EMAIL_SHARELINK_CONFIRMATION', 'DONE');
    expect(job.attempts).toBe(0);
    expect(job.lastError).toBeNull();
  });

  it('a job the nudge misses is still drained by the OutboxPump cron alone', async () => {
    // Simulates arch §13.2's own stated safety-net scenario ("the nudge
    // missed [a row] because the process crashed") without touching product
    // code: neuters the real OutboxService instance's nudge() for this one
    // test only, so the enqueue from the real HTTP call below has nothing
    // draining it until the cron handler is invoked explicitly.
    jest.spyOn(outboxService, 'nudge').mockImplementation(() => undefined);

    const link = await seedPlayerStaticLink();
    const res = await request(app.getHttpServer()).post(`/share-links/${link.code}/redeem`).send(redeemDto());
    expect(res.status).toBe(201);

    const pending = await db.prisma.outboxJob.findFirstOrThrow({ where: { type: 'EMAIL_SHARELINK_CONFIRMATION' } });
    expect(pending.status).toBe('PENDING');

    // The exact handler OutboxPump's @Cron(EVERY_30_SECONDS) invokes on
    // every tick (outbox-pump.ts) — proving the cron is independently
    // sufficient, not merely redundant with the nudge.
    await outboxPump.drain();

    const drained = await db.prisma.outboxJob.findUniqueOrThrow({ where: { id: pending.id } });
    expect(drained.status).toBe('DONE');
  });

  it('re-running the drain against an already-DONE job is idempotent — no double-send', async () => {
    jest.spyOn(outboxService, 'nudge').mockImplementation(() => undefined);

    const link = await seedPlayerStaticLink();
    await request(app.getHttpServer()).post(`/share-links/${link.code}/redeem`).send(redeemDto());

    const firstPassProcessed = await outboxService.drainOnce();
    expect(firstPassProcessed).toBe(1);

    const done = await db.prisma.outboxJob.findFirstOrThrow({ where: { type: 'EMAIL_SHARELINK_CONFIRMATION' } });
    expect(done.status).toBe('DONE');

    // A DONE row is not PENDING, so claimBatch's `WHERE status = 'PENDING'`
    // (outbox.repository.ts) must not pick it back up on a re-run.
    const secondPassProcessed = await outboxService.drainOnce();
    expect(secondPassProcessed).toBe(0);

    const stillDone = await db.prisma.outboxJob.findUniqueOrThrow({ where: { id: done.id } });
    expect(stillDone.status).toBe('DONE');
    expect(stillDone.attempts).toBe(done.attempts);
  });
});
