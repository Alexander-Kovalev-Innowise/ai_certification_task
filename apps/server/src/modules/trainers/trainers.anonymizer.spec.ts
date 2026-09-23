import { randomUUID } from 'node:crypto';

import {
  resetTestDatabase,
  startTestDatabase,
  stopTestDatabase,
  TestDatabase,
} from '../../../test/setup/testcontainers.setup';

// Task 3.10. Testcontainers-backed, same pattern as users.anonymizer.spec.ts
// (Task 3.4) — asserts the real field transforms against a real Postgres
// row seeded via a TrainerProfile.
describe('TrainersAnonymizer (Task 3.10)', () => {
  jest.setTimeout(120_000);

  let db: TestDatabase;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamically required after DATABASE_URL is set, see beforeAll
  let prismaService: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let anonymizer: any;

  const originalDatabaseUrl = process.env.DATABASE_URL;

  beforeAll(async () => {
    db = await startTestDatabase();
    process.env.DATABASE_URL = db.connectionUri;

    /* eslint-disable @typescript-eslint/no-require-imports -- deliberate, defers evaluation until after DATABASE_URL is set */
    const { PrismaService } = require('../../shared/prisma/prisma.service') as typeof import('../../shared/prisma/prisma.service');
    const { TrainersAnonymizer } = require('./trainers.anonymizer') as typeof import('./trainers.anonymizer');
    /* eslint-enable @typescript-eslint/no-require-imports */

    prismaService = new PrismaService();
    await prismaService.onModuleInit();
    anonymizer = new TrainersAnonymizer();
  });

  afterAll(async () => {
    await prismaService?.onModuleDestroy();
    await stopTestDatabase(db);
    process.env.DATABASE_URL = originalDatabaseUrl;
  });

  afterEach(async () => {
    await resetTestDatabase(db);
  });

  async function insertTrainerUser(): Promise<{ userId: string; trainerId: string }> {
    const userId = randomUUID();
    await prismaService.user.create({
      data: { id: userId, email: `${userId}@example.com`, passwordHash: 'hash', role: 'TRAINER', firstName: 'T', lastName: 'One' },
    });
    const trainerId = randomUUID();
    await prismaService.trainerProfile.create({
      data: {
        id: trainerId,
        userId,
        businessName: 'Real Business Name',
        address: '123 Real St',
        website: 'https://real-business.example.com',
        description: 'A real description',
      },
    });
    return { userId, trainerId };
  }

  it('declares its model as "TrainerProfile"', () => {
    expect(anonymizer.model).toBe('TrainerProfile');
  });

  it('anonymizes exactly businessName/address/website/description, keyed by userId', async () => {
    const { userId, trainerId } = await insertTrainerUser();

    await prismaService.$transaction(async (tx: unknown) => {
      await anonymizer.anonymize(userId, tx);
    });

    const row = await prismaService.trainerProfile.findUnique({ where: { id: trainerId } });
    expect(row.businessName).toBe('Deleted Business');
    expect(row.address).toBeNull();
    expect(row.website).toBeNull();
    expect(row.description).toBeNull();
    // Untouched: not this anonymizer's concern.
    expect(row.userId).toBe(userId);
  });

  it('is a no-op for a userId with no TrainerProfile (most deleted users)', async () => {
    const nonTrainerUserId = randomUUID();
    await prismaService.user.create({
      data: { id: nonTrainerUserId, email: `${nonTrainerUserId}@example.com`, passwordHash: 'hash', role: 'PLAYER_PARENT', firstName: 'P', lastName: 'One' },
    });

    await expect(
      prismaService.$transaction(async (tx: unknown) => {
        await anonymizer.anonymize(nonTrainerUserId, tx);
      }),
    ).resolves.not.toThrow();
  });
});
