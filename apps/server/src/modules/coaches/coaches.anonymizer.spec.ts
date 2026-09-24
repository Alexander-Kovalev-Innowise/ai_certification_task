import { randomUUID } from 'node:crypto';

import {
  resetTestDatabase,
  startTestDatabase,
  stopTestDatabase,
  TestDatabase,
} from '../../../test/setup/testcontainers.setup';

// Task 6.4. Testcontainers-backed, same pattern as trainers.anonymizer.spec.ts
// (Task 3.10) — asserts the real field transforms against a real Postgres
// row seeded via a CoachProfile.
describe('CoachesAnonymizer (Task 6.4)', () => {
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
    const { CoachesAnonymizer } = require('./coaches.anonymizer') as typeof import('./coaches.anonymizer');
    /* eslint-enable @typescript-eslint/no-require-imports */

    prismaService = new PrismaService();
    await prismaService.onModuleInit();
    anonymizer = new CoachesAnonymizer();
  });

  afterAll(async () => {
    await prismaService?.onModuleDestroy();
    await stopTestDatabase(db);
    process.env.DATABASE_URL = originalDatabaseUrl;
  });

  afterEach(async () => {
    await resetTestDatabase(db);
  });

  async function insertCoachUser(): Promise<{ userId: string; coachId: string; trainerId: string }> {
    const trainerUserId = randomUUID();
    await prismaService.user.create({
      data: { id: trainerUserId, email: `${trainerUserId}@example.com`, passwordHash: 'hash', role: 'TRAINER', firstName: 'T', lastName: 'One' },
    });
    const trainerId = randomUUID();
    await prismaService.trainerProfile.create({
      data: { id: trainerId, userId: trainerUserId, businessName: 'Acme Co' },
    });

    const userId = randomUUID();
    await prismaService.user.create({
      data: { id: userId, email: `${userId}@example.com`, passwordHash: 'hash', role: 'COACH', firstName: 'C', lastName: 'One' },
    });
    const coachId = randomUUID();
    await prismaService.coachProfile.create({
      data: {
        id: coachId,
        userId,
        trainerId,
        bio: 'A real bio',
        credentials: 'USSF National License',
        certifications: 'CPR, First Aid',
        publicProfile: true,
        status: 'ACTIVE',
      },
    });
    return { userId, coachId, trainerId };
  }

  it('declares its model as "CoachProfile"', () => {
    expect(anonymizer.model).toBe('CoachProfile');
  });

  it('anonymizes exactly bio/credentials, keyed by userId', async () => {
    const { userId, coachId } = await insertCoachUser();

    await prismaService.$transaction(async (tx: unknown) => {
      await anonymizer.anonymize(userId, tx);
    });

    const row = await prismaService.coachProfile.findUnique({ where: { id: coachId } });
    expect(row.bio).toBeNull();
    expect(row.credentials).toBeNull();
    // Untouched: not this anonymizer's concern (arch §11.2's literal scope note).
    expect(row.certifications).toBe('CPR, First Aid');
    expect(row.publicProfile).toBe(true);
    expect(row.userId).toBe(userId);
  });

  it('is a no-op for a userId with no CoachProfile (most deleted users)', async () => {
    const nonCoachUserId = randomUUID();
    await prismaService.user.create({
      data: { id: nonCoachUserId, email: `${nonCoachUserId}@example.com`, passwordHash: 'hash', role: 'PLAYER_PARENT', firstName: 'P', lastName: 'One' },
    });

    await expect(
      prismaService.$transaction(async (tx: unknown) => {
        await anonymizer.anonymize(nonCoachUserId, tx);
      }),
    ).resolves.not.toThrow();
  });
});
