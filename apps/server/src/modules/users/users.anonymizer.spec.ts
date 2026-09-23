import { randomUUID } from 'node:crypto';

import {
  resetTestDatabase,
  startTestDatabase,
  stopTestDatabase,
  TestDatabase,
} from '../../../test/setup/testcontainers.setup';

// Task 3.4. Testcontainers-backed (like account-provisioning.service.spec.ts)
// — asserts the real field transforms against a real Postgres row, not just
// the shape of a mocked `tx.user.update(...)` call.
describe('UsersAnonymizer (Task 3.4)', () => {
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
    const { UsersAnonymizer } = require('./users.anonymizer') as typeof import('./users.anonymizer');
    /* eslint-enable @typescript-eslint/no-require-imports */

    prismaService = new PrismaService();
    await prismaService.onModuleInit();
    anonymizer = new UsersAnonymizer();
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
      data: {
        id,
        email: `${id}@example.com`,
        passwordHash: 'hash',
        role: 'PLAYER_PARENT',
        firstName: 'Original',
        lastName: 'Name',
        phone: '+15551234567',
        photoUrl: 'https://example.com/photo.png',
      },
    });
    return id;
  }

  it('declares its model as "User"', () => {
    expect(anonymizer.model).toBe('User');
  });

  it('anonymizes exactly firstName/lastName/email/phone/photoUrl, nothing else', async () => {
    const userId = await insertUser();

    await prismaService.$transaction(async (tx: unknown) => {
      await anonymizer.anonymize(userId, tx);
    });

    const row = await prismaService.user.findUnique({ where: { id: userId } });

    expect(row.firstName).toBe('Deleted');
    expect(row.lastName).toBe('User');
    expect(row.email).toBe(`deleted_${userId}@example.com`);
    expect(row.phone).toBeNull();
    expect(row.photoUrl).toBeNull();

    // Untouched by this anonymizer — AccountLifecycleService's own concern (Task 3.7).
    expect(row.status).toBe('ACTIVE');
    expect(row.deletedAt).toBeNull();
    expect(row.passwordHash).toBe('hash');
  });
});
