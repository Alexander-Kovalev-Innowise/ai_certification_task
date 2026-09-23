import { randomUUID } from 'node:crypto';

import {
  resetTestDatabase,
  startTestDatabase,
  stopTestDatabase,
  TestDatabase,
} from '../../../test/setup/testcontainers.setup';

// Task 5.6. Testcontainers-backed, same convention as users.anonymizer.spec.ts.
describe('PlayerProfilesAnonymizer (Task 5.6)', () => {
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
    const { PlayerProfilesAnonymizer } = require('./player-profiles.anonymizer') as typeof import('./player-profiles.anonymizer');
    /* eslint-enable @typescript-eslint/no-require-imports */

    prismaService = new PrismaService();
    await prismaService.onModuleInit();
    anonymizer = new PlayerProfilesAnonymizer();
  });

  afterAll(async () => {
    await prismaService?.onModuleDestroy();
    await stopTestDatabase(db);
    process.env.DATABASE_URL = originalDatabaseUrl;
  });

  afterEach(async () => {
    await resetTestDatabase(db);
  });

  async function insertParentUser(): Promise<string> {
    const id = randomUUID();
    await prismaService.user.create({
      data: { id, email: `${id}@example.com`, passwordHash: 'hash', role: 'PLAYER_PARENT', firstName: 'A', lastName: 'B' },
    });
    return id;
  }

  it('declares its model as "PlayerProfile"', () => {
    expect(anonymizer.model).toBe('PlayerProfile');
  });

  it('anonymizes name/school/jerseyNumber/photoUrl/emergencyContact for every profile the deleted account owns', async () => {
    const parentId = await insertParentUser();
    const profile = await prismaService.playerProfile.create({
      data: {
        accountUserId: parentId,
        name: 'Real Kid Name',
        dateOfBirth: new Date('2015-01-01'),
        gender: 'MALE',
        school: 'Real School',
        jerseyNumber: '9',
        photoUrl: 'https://example.com/kid.png',
        emergencyContact: { name: 'Grandma', phone: '+15551234567' },
      },
    });

    await prismaService.$transaction(async (tx: unknown) => {
      await anonymizer.anonymize(parentId, tx);
    });

    const row = await prismaService.playerProfile.findUnique({ where: { id: profile.id } });

    expect(row.name).toBe('Deleted Player');
    expect(row.school).toBeNull();
    expect(row.jerseyNumber).toBeNull();
    expect(row.photoUrl).toBeNull();
    expect(row.emergencyContact).toBeNull();

    // Untouched — not PII in the name/contact sense.
    expect(row.gender).toBe('MALE');
    expect(row.dateOfBirth.toISOString()).toBe(new Date('2015-01-01').toISOString());
  });

  it('also anonymizes a profile reached via its own childUserId login, not just accountUserId', async () => {
    const parentId = await insertParentUser();
    const childId = await insertParentUser();
    const profile = await prismaService.playerProfile.create({
      data: {
        accountUserId: parentId,
        childUserId: childId,
        name: 'Real Kid Name',
        dateOfBirth: new Date('2015-01-01'),
        gender: 'MALE',
      },
    });

    await prismaService.$transaction(async (tx: unknown) => {
      await anonymizer.anonymize(childId, tx);
    });

    const row = await prismaService.playerProfile.findUnique({ where: { id: profile.id } });
    expect(row.name).toBe('Deleted Player');
  });
});
