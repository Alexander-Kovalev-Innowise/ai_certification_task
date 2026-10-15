import type { INestApplication } from '@nestjs/common';

import { startTestDatabase, stopTestDatabase, TestDatabase } from './setup/testcontainers.setup';

// Task 9.3 (arch §13.1/§20 DoD — SCHEDULER_ENABLED verification). Boots the
// REAL AppModule twice, once per value of SCHEDULER_ENABLED, and inspects
// the module graph rather than waiting out real cron ticks (the fastest of
// the five gated jobs, OutboxPump, only fires every 30s — far too slow for
// a test, and a "did it fire within N seconds" test would be flaky by
// construction). `ScheduleModule.forRoot()` — and every `@Cron` provider
// (OutboxPump, ApprovalExpiryJob, TokenMaintenanceJob,
// ImpersonationMaintenanceJob, ShareLinkMaintenanceJob) — is only ever
// wired into the graph when SCHEDULER_ENABLED (shared/jobs/jobs.module.ts
// + the four feature modules that follow its convention). With it false,
// `SchedulerRegistry` itself isn't resolvable: not merely "registered but
// not firing", but structurally incapable of firing at all, which is a
// stronger proof than "no cron fired during the test window" would be.
//
// Same env-var-before-import / jest.resetModules() discipline
// jwt-auth-guard.e2e-spec.ts documents: `env` (shared/config/config.module.ts)
// is computed once per module realm at first import, so SCHEDULER_ENABLED
// must be set and the whole Nest stack (including `@nestjs/testing`'s own
// `Test`) re-required fresh, in the same realm, for each of the two boots
// below — never mixing a pre-reset reference with a post-reset one.
describe('SCHEDULER_ENABLED gates the scheduler end to end (Task 9.3 DoD)', () => {
  jest.setTimeout(180_000);

  let db: TestDatabase;
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const originalSchedulerEnabled = process.env.SCHEDULER_ENABLED;

  beforeAll(async () => {
    db = await startTestDatabase();
    process.env.DATABASE_URL = db.connectionUri;
  });

  afterAll(async () => {
    await stopTestDatabase(db);
    process.env.DATABASE_URL = originalDatabaseUrl;
    process.env.SCHEDULER_ENABLED = originalSchedulerEnabled;
    jest.resetModules();
  });

  /**
   * Boots a fresh AppModule in its own module realm, with `SCHEDULER_ENABLED`
   * set to `value` beforehand. `reset` is false only for the very first boot
   * in this file (nothing under `../src` has been required yet in this
   * file's registry, so there's nothing stale to clear — resetting anyway is
   * harmless here but every later call must reset).
   */
  async function bootAppWithScheduler(value: 'true' | 'false', reset: boolean): Promise<{ app: INestApplication; schedulerRegistry: unknown }> {
    process.env.SCHEDULER_ENABLED = value;
    if (reset) {
      jest.resetModules();
    }

    /* eslint-disable @typescript-eslint/no-require-imports -- deliberate, defers evaluation until after SCHEDULER_ENABLED is set; re-required fresh per boot, including `Test` itself, so nothing pre-reset leaks into a post-reset realm */
    const { Test } = require('@nestjs/testing') as typeof import('@nestjs/testing');
    const { SchedulerRegistry } = require('@nestjs/schedule') as typeof import('@nestjs/schedule');
    const { AppModule } = require('../src/app.module') as typeof import('../src/app.module');
    /* eslint-enable @typescript-eslint/no-require-imports */

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = moduleRef.createNestApplication();
    await app.init();

    // moduleRef.get(Token, { strict: false }) still THROWS (not returns
    // undefined) when the token exists nowhere in the whole container tree —
    // `strict: false` only relaxes "must resolve from this exact module" to
    // "search the whole tree". Absence is therefore observed as a throw.
    let schedulerRegistry: unknown;
    try {
      schedulerRegistry = moduleRef.get(SchedulerRegistry, { strict: false }) as unknown;
    } catch {
      schedulerRegistry = undefined;
    }
    return { app, schedulerRegistry };
  }

  it('SCHEDULER_ENABLED=false: SchedulerRegistry is not wired into the graph at all — nothing can fire', async () => {
    const { app, schedulerRegistry } = await bootAppWithScheduler('false', false);
    try {
      expect(schedulerRegistry).toBeUndefined();
    } finally {
      await app.close();
    }
  });

  it('SCHEDULER_ENABLED=true (control): SchedulerRegistry exists and all five gated cron jobs are actually registered', async () => {
    const { app, schedulerRegistry } = await bootAppWithScheduler('true', true);
    try {
      expect(schedulerRegistry).toBeDefined();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- SchedulerRegistry type comes from a dynamically-required @nestjs/schedule realm
      const cronJobNames = [...(schedulerRegistry as any).getCronJobs().keys()] as string[];
      // One handler per gated job class (arch §13.1's table): OutboxPump,
      // ApprovalExpiryJob, TokenMaintenanceJob, ImpersonationMaintenanceJob,
      // ShareLinkMaintenanceJob — proving the false case above is a real
      // absence, not an artifact of a broken require path.
      expect(cronJobNames.length).toBe(5);
    } finally {
      await app.close();
    }
  });
});
