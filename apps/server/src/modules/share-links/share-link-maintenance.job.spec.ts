import { randomUUID } from 'node:crypto';

import {
  resetTestDatabase,
  startTestDatabase,
  stopTestDatabase,
  TestDatabase,
} from '../../../test/setup/testcontainers.setup';

// Task 4.14. Testcontainers-backed (like token-maintenance.job.spec.ts) —
// real-database update behavior, not worth mocking.
describe('ShareLinkMaintenanceJob (Task 4.14)', () => {
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
    const { ShareLinkMaintenanceJob } = require('./share-link-maintenance.job') as typeof import('./share-link-maintenance.job');
    /* eslint-enable @typescript-eslint/no-require-imports */

    prismaService = new PrismaService();
    await prismaService.onModuleInit();
    job = new ShareLinkMaintenanceJob(prismaService);
  });

  afterAll(async () => {
    await prismaService?.onModuleDestroy();
    await stopTestDatabase(db);
    process.env.DATABASE_URL = originalDatabaseUrl;
  });

  afterEach(async () => {
    await resetTestDatabase(db);
  });

  async function seedTrainer(): Promise<{ trainerId: string; trainerUserId: string }> {
    const trainerUserId = randomUUID();
    await prismaService.user.create({
      data: { id: trainerUserId, email: `${trainerUserId}@example.com`, passwordHash: 'x', role: 'TRAINER', firstName: 'T', lastName: 'R', status: 'ACTIVE' },
    });
    const trainerId = randomUUID();
    await prismaService.trainerProfile.create({ data: { id: trainerId, userId: trainerUserId, businessName: 'Acme Co' } });
    return { trainerId, trainerUserId };
  }

  const past = () => new Date(Date.now() - 60_000);
  const future = () => new Date(Date.now() + 60_000);

  it('marks an expired-but-still-ACTIVE link EXPIRED, leaves unexpired and non-expiring links untouched', async () => {
    const { trainerId, trainerUserId } = await seedTrainer();

    const expiredLink = await prismaService.shareLink.create({
      data: { code: randomUUID(), type: 'COACH_UNIQUE', trainerId, createdByUserId: trainerUserId, targetEmail: 'a@example.com', expiresAt: past(), status: 'ACTIVE' },
    });
    const freshLink = await prismaService.shareLink.create({
      data: { code: randomUUID(), type: 'COACH_UNIQUE', trainerId, createdByUserId: trainerUserId, targetEmail: 'b@example.com', expiresAt: future(), status: 'ACTIVE' },
    });
    const staticLink = await prismaService.shareLink.create({
      data: { code: randomUUID(), type: 'PLAYER_STATIC', trainerId, createdByUserId: trainerUserId, status: 'ACTIVE' },
    });
    const alreadyRevokedLink = await prismaService.shareLink.create({
      data: { code: randomUUID(), type: 'COACH_UNIQUE', trainerId, createdByUserId: trainerUserId, targetEmail: 'c@example.com', expiresAt: past(), status: 'REVOKED' },
    });

    await job.markExpiredLinks();

    const refreshedExpired = await prismaService.shareLink.findUnique({ where: { id: expiredLink.id } });
    expect(refreshedExpired.status).toBe('EXPIRED');

    const refreshedFresh = await prismaService.shareLink.findUnique({ where: { id: freshLink.id } });
    expect(refreshedFresh.status).toBe('ACTIVE');

    const refreshedStatic = await prismaService.shareLink.findUnique({ where: { id: staticLink.id } });
    expect(refreshedStatic.status).toBe('ACTIVE');

    const refreshedRevoked = await prismaService.shareLink.findUnique({ where: { id: alreadyRevokedLink.id } });
    expect(refreshedRevoked.status).toBe('REVOKED');
  });

  it('is a no-op (does not throw) when nothing is expired', async () => {
    await expect(job.markExpiredLinks()).resolves.toBeUndefined();
  });
});
