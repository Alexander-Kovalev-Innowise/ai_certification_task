import { randomUUID } from 'node:crypto';

import {
  resetTestDatabase,
  startTestDatabase,
  stopTestDatabase,
  TestDatabase,
} from '../../../test/setup/testcontainers.setup';

// Task 2.10. Testcontainers-backed (like prisma.service.spec.ts and the
// three Task 1.5/1.6/1.7 extension specs) — this task's whole point is
// transaction atomicity, which a mocked Prisma client cannot meaningfully
// prove (a mock never rolls back). Same env-var-before-import dance as
// jwt-auth-guard.e2e-spec.ts: DATABASE_URL must point at the container
// before shared/config/config.module.ts (imported transitively by
// PrismaService) is first evaluated.
describe('AccountProvisioningService (Task 2.10)', () => {
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
    const { UsersRepository } = require('./users.repository') as typeof import('./users.repository');
    const { AccountProvisioningService } = require('./account-provisioning.service') as typeof import('./account-provisioning.service');
    /* eslint-enable @typescript-eslint/no-require-imports */

    prismaService = new PrismaService();
    await prismaService.onModuleInit();
    const usersRepository = new UsersRepository(prismaService);
    service = new AccountProvisioningService(prismaService, usersRepository);
  });

  afterAll(async () => {
    await prismaService?.onModuleDestroy();
    await stopTestDatabase(db);
    process.env.DATABASE_URL = originalDatabaseUrl;
  });

  afterEach(async () => {
    await resetTestDatabase(db);
  });

  function baseInput(overrides: Record<string, unknown> = {}) {
    const email = `${randomUUID()}@example.com`;
    return {
      role: 'TRAINER' as const,
      email,
      passwordHash: 'hash',
      firstName: 'A',
      lastName: 'B',
      ...overrides,
    };
  }

  it('creates a User and its profile together, committed atomically', async () => {
    const input = baseInput({
      createProfile: async (tx: unknown, userId: string) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- tx is a Prisma.TransactionClient
        await (tx as any).trainerProfile.create({ data: { userId, businessName: 'Test Co' } });
      },
    });

    const user = await service.createUserWithProfile(input);

    const persistedUser = await prismaService.user.findUnique({ where: { id: user.id } });
    const persistedProfile = await prismaService.trainerProfile.findUnique({ where: { userId: user.id } });

    expect(persistedUser).not.toBeNull();
    expect(persistedUser.email).toBe(input.email);
    expect(persistedProfile).not.toBeNull();
    expect(persistedProfile.businessName).toBe('Test Co');
  });

  it('leaves no orphan User row when profile creation fails partway through', async () => {
    const input = baseInput({
      createProfile: async () => {
        throw new Error('simulated profile-creation failure');
      },
    });

    await expect(service.createUserWithProfile(input)).rejects.toThrow('simulated profile-creation failure');

    const persistedUser = await prismaService.user.findUnique({ where: { email: input.email } });
    expect(persistedUser).toBeNull();
  });

  it('creates a User with no profile at all when createProfile is omitted', async () => {
    const input = baseInput({ role: 'SUPER_ADMIN' });

    const user = await service.createUserWithProfile(input);

    const persistedUser = await prismaService.user.findUnique({ where: { id: user.id } });
    expect(persistedUser).not.toBeNull();
  });
});
