import { randomUUID } from 'node:crypto';

import { resetTestDatabase, startTestDatabase, stopTestDatabase, TestDatabase } from './setup/testcontainers.setup';

// Task 1.9 — proves the shared harness itself: one container, migrations
// applied once, and resetTestDatabase() actually clears rows between tests.
describe('shared Testcontainers harness (Task 1.9)', () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await startTestDatabase();
  });

  afterAll(async () => {
    await stopTestDatabase(db);
  });

  afterEach(async () => {
    await resetTestDatabase(db);
  });

  async function insertUser(): Promise<string> {
    const id = randomUUID();
    await db.prisma.user.create({
      data: {
        id,
        email: `${id}@example.com`,
        passwordHash: 'hash',
        role: 'PLAYER_PARENT',
        firstName: 'A',
        lastName: 'B',
      },
    });
    return id;
  }

  it("applies every migration, including Task 1.2's raw SQL (pg_trgm index present)", async () => {
    const rows = await db.prisma.$queryRawUnsafe<{ indexname: string }[]>(
      `SELECT indexname FROM pg_indexes WHERE indexname = 'user_email_trgm_idx'`,
    );
    expect(rows).toHaveLength(1);
  });

  it('starts with no User rows', async () => {
    const count = await db.prisma.user.count();
    expect(count).toBe(0);
  });

  it('can insert a row in one test', async () => {
    await insertUser();
    const count = await db.prisma.user.count();
    expect(count).toBe(1);
  });

  it('resetTestDatabase clears the row inserted by the previous test', async () => {
    const count = await db.prisma.user.count();
    expect(count).toBe(0);
  });
});
