import { randomUUID } from 'node:crypto';

import {
  resetTestDatabase,
  startTestDatabase,
  stopTestDatabase,
  TestDatabase,
} from '../../../test/setup/testcontainers.setup';

// Task 7.4. Testcontainers-backed — this is real-database update behavior
// (`$executeRaw`), not something worth mocking, same rationale
// token-maintenance.job.spec.ts gives for its own Testcontainers use.
describe('ImpersonationMaintenanceJob (Task 7.4)', () => {
  jest.setTimeout(120_000);

  let db: TestDatabase;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamically required after DATABASE_URL is set, see beforeAll
  let prismaService: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let job: any;

  const originalDatabaseUrl = process.env.DATABASE_URL;

  beforeAll(async () => {
    db = await startTestDatabase();
    process.env.DATABASE_URL = db.connectionUri;

    /* eslint-disable @typescript-eslint/no-require-imports -- deliberate, defers evaluation until after DATABASE_URL is set */
    const { PrismaService } = require('../../shared/prisma/prisma.service') as typeof import('../../shared/prisma/prisma.service');
    const { ImpersonationRepository } = require('./impersonation.repository') as typeof import('./impersonation.repository');
    const { ImpersonationMaintenanceJob } = require('./impersonation-maintenance.job') as typeof import('./impersonation-maintenance.job');
    /* eslint-enable @typescript-eslint/no-require-imports */

    prismaService = new PrismaService();
    await prismaService.onModuleInit();
    const impersonationRepository = new ImpersonationRepository(prismaService);
    job = new ImpersonationMaintenanceJob(impersonationRepository);
  });

  afterAll(async () => {
    await prismaService?.onModuleDestroy();
    await stopTestDatabase(db);
    process.env.DATABASE_URL = originalDatabaseUrl;
  });

  afterEach(async () => {
    await resetTestDatabase(db);
  });

  async function insertUser(): Promise<string> {
    const id = randomUUID();
    await prismaService.user.create({
      data: { id, email: `${id}@example.com`, passwordHash: 'hash', role: 'TRAINER', firstName: 'A', lastName: 'B' },
    });
    return id;
  }

  async function insertLog(startedAt: Date, endedAt: Date | null = null): Promise<string> {
    const adminUserId = await insertUser();
    const targetUserId = await insertUser();
    const log = await prismaService.impersonationLog.create({
      data: { adminUserId, targetUserId, startedAt, endedAt, durationSeconds: endedAt ? 0 : null },
    });
    return log.id;
  }

  const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);

  it('closes a stale open log (started > 60 minutes ago) with endedAt = startedAt + 60m and durationSeconds = 3600', async () => {
    const startedAt = minutesAgo(90);
    const staleId = await insertLog(startedAt);

    await job.sweep();

    const row = await prismaService.impersonationLog.findUniqueOrThrow({ where: { id: staleId } });
    expect(row.endedAt).not.toBeNull();
    expect(row.endedAt.getTime()).toBe(startedAt.getTime() + 60 * 60_000);
    expect(row.durationSeconds).toBe(3600);
  });

  it('leaves a fresh open log (started < 60 minutes ago) untouched', async () => {
    const freshId = await insertLog(minutesAgo(5));

    await job.sweep();

    const row = await prismaService.impersonationLog.findUniqueOrThrow({ where: { id: freshId } });
    expect(row.endedAt).toBeNull();
    expect(row.durationSeconds).toBeNull();
  });

  it('leaves an already-closed log (explicit /end call) untouched, even if started > 60 minutes ago', async () => {
    const startedAt = minutesAgo(90);
    const explicitEndedAt = minutesAgo(85);
    const closedId = await insertLog(startedAt, explicitEndedAt);

    await job.sweep();

    const row = await prismaService.impersonationLog.findUniqueOrThrow({ where: { id: closedId } });
    expect(row.endedAt.getTime()).toBe(explicitEndedAt.getTime());
  });

  it('is a no-op (does not throw) when there is nothing stale', async () => {
    await expect(job.sweep()).resolves.toBeUndefined();
  });
});
