import { randomUUID } from 'node:crypto';

import {
  resetTestDatabase,
  startTestDatabase,
  stopTestDatabase,
  TestDatabase,
} from '../../../test/setup/testcontainers.setup';

// Task 2.21. Testcontainers-backed — this is real-database deletion
// behavior, not something worth mocking.
describe('TokenMaintenanceJob (Task 2.21)', () => {
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
    const { TokenMaintenanceJob } = require('./token-maintenance.job') as typeof import('./token-maintenance.job');
    /* eslint-enable @typescript-eslint/no-require-imports */

    prismaService = new PrismaService();
    await prismaService.onModuleInit();
    job = new TokenMaintenanceJob(prismaService);
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
      data: { id, email: `${id}@example.com`, passwordHash: 'hash', role: 'PLAYER_PARENT', firstName: 'A', lastName: 'B' },
    });
    return id;
  }

  const past = () => new Date(Date.now() - 1000);
  const future = () => new Date(Date.now() + 60 * 60 * 1000);

  it('removes expired rows of all three token types and leaves unexpired rows untouched', async () => {
    const userId = await insertUser();

    await prismaService.refreshToken.create({
      data: { userId, tokenHash: 'expired-rt', familyId: randomUUID(), expiresAt: past() },
    });
    const keptRefresh = await prismaService.refreshToken.create({
      data: { userId, tokenHash: 'fresh-rt', familyId: randomUUID(), expiresAt: future() },
    });

    await prismaService.emailVerificationToken.create({ data: { userId, token: 'expired-evt', expiresAt: past() } });
    const keptVerification = await prismaService.emailVerificationToken.create({
      data: { userId, token: 'fresh-evt', expiresAt: future() },
    });

    await prismaService.passwordResetToken.create({ data: { userId, token: 'expired-prt', expiresAt: past() } });
    const keptReset = await prismaService.passwordResetToken.create({
      data: { userId, token: 'fresh-prt', expiresAt: future() },
    });

    await job.purgeExpiredTokens();

    expect(await prismaService.refreshToken.findMany({})).toEqual([expect.objectContaining({ id: keptRefresh.id })]);
    expect(await prismaService.emailVerificationToken.findMany({})).toEqual([
      expect.objectContaining({ id: keptVerification.id }),
    ]);
    expect(await prismaService.passwordResetToken.findMany({})).toEqual([
      expect.objectContaining({ id: keptReset.id }),
    ]);
  });

  it('is a no-op (does not throw) when there is nothing expired', async () => {
    await expect(job.purgeExpiredTokens()).resolves.toBeUndefined();
  });
});
