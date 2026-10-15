import { randomUUID } from 'node:crypto';

import {
  resetTestDatabase,
  startTestDatabase,
  stopTestDatabase,
  TestDatabase,
} from '../../../test/setup/testcontainers.setup';

// Task 2.12 (arch §6.4). Testcontainers-backed — rotation/reuse-detection is
// real-database behavior (conditional updates, transaction atomicity), not
// something a mocked Prisma client can prove.
describe('TokenRotationService (Task 2.12)', () => {
  jest.setTimeout(120_000);

  let db: TestDatabase;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamically required after DATABASE_URL is set, see beforeAll
  let prismaService: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let service: any;

  const originalDatabaseUrl = process.env.DATABASE_URL;

  beforeAll(async () => {
    db = await startTestDatabase();
    process.env.DATABASE_URL = db.connectionUri;

    /* eslint-disable @typescript-eslint/no-require-imports -- deliberate, defers evaluation until after DATABASE_URL is set */
    const { PrismaService } = require('../../shared/prisma/prisma.service') as typeof import('../../shared/prisma/prisma.service');
    const { UsersRepository } = require('../users/users.repository') as typeof import('../users/users.repository');
    const { RefreshTokenRepository } = require('./refresh-token.repository') as typeof import('./refresh-token.repository');
    const { TokenRotationService } = require('./token-rotation.service') as typeof import('./token-rotation.service');
    /* eslint-enable @typescript-eslint/no-require-imports */

    prismaService = new PrismaService();
    await prismaService.onModuleInit();
    const usersRepository = new UsersRepository(prismaService);
    const refreshTokenRepository = new RefreshTokenRepository(prismaService);
    service = new TokenRotationService(prismaService, refreshTokenRepository, usersRepository);
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
        firstName: 'A',
        lastName: 'B',
      },
    });
    return id;
  }

  function futureDate(): Date {
    return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  }

  it('normal rotation marks the old row revoked and creates a new row with the same familyId', async () => {
    const userId = await insertUser();
    const familyId = randomUUID();
    await service.issueNewFamily(userId, 'hash-1', familyId, futureDate());

    const rotated = await service.rotate('hash-1', 'hash-2', futureDate());

    const oldRow = await prismaService.refreshToken.findUnique({ where: { tokenHash: 'hash-1' } });
    expect(oldRow.revokedAt).not.toBeNull();
    expect(rotated.familyId).toBe(familyId);
    expect(rotated.tokenHash).toBe('hash-2');
    expect(rotated.revokedAt).toBeNull();
  });

  it('presenting an already-revoked token revokes the whole family and bumps tokenVersion (reuse detection)', async () => {
    const userId = await insertUser();
    const familyId = randomUUID();
    await service.issueNewFamily(userId, 'hash-1', familyId, futureDate());
    // Ordinary rotation once, producing hash-2 (current) while hash-1 becomes revoked.
    await service.rotate('hash-1', 'hash-2', futureDate());

    // Attacker (or a race) re-presents the now-revoked hash-1.
    await expect(service.rotate('hash-1', 'hash-3', futureDate())).rejects.toThrow();

    const family = await prismaService.refreshToken.findMany({ where: { familyId } });
    expect(family.every((row: { revokedAt: Date | null }) => row.revokedAt !== null)).toBe(true);

    const user = await prismaService.user.findUnique({ where: { id: userId } });
    expect(user.tokenVersion).toBe(1);

    // hash-3 must never have been created — the reuse branch doesn't issue a new token.
    const hash3Row = await prismaService.refreshToken.findUnique({ where: { tokenHash: 'hash-3' } });
    expect(hash3Row).toBeNull();
  });

  it('rejects rotation of an unknown token hash', async () => {
    await expect(service.rotate('does-not-exist', 'hash-x', futureDate())).rejects.toThrow();
  });

  it('rejects rotation of an expired (but not revoked) token', async () => {
    const userId = await insertUser();
    const familyId = randomUUID();
    const past = new Date(Date.now() - 1000);
    await service.issueNewFamily(userId, 'hash-expired', familyId, past);

    await expect(service.rotate('hash-expired', 'hash-y', futureDate())).rejects.toThrow();
  });
});
