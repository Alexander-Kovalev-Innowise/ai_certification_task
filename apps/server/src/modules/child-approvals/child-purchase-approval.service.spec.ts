import { randomUUID } from 'node:crypto';

import {
  resetTestDatabase,
  startTestDatabase,
  stopTestDatabase,
  TestDatabase,
} from '../../../test/setup/testcontainers.setup';

// Task 5.12. `createRequest` is the Epic-02 checkout forward-integration
// seam (INT-003, arch §9.3) — no public endpoint calls it in Epic-01, so
// it's exercised directly here (Testcontainers-backed, matching this
// codebase's convention for anything that writes real rows) rather than
// only implicitly through e2e fixtures.
describe('ChildPurchaseApprovalService.createRequest (Task 5.12)', () => {
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
    const { ChildApprovalsRepository } = require('./child-approvals.repository') as typeof import('./child-approvals.repository');
    const { ChildPurchaseApprovalService } = require('./child-purchase-approval.service') as typeof import('./child-purchase-approval.service');
    /* eslint-enable @typescript-eslint/no-require-imports */

    prismaService = new PrismaService();
    await prismaService.onModuleInit();
    service = new ChildPurchaseApprovalService(new ChildApprovalsRepository(prismaService));
  });

  afterAll(async () => {
    await prismaService?.onModuleDestroy();
    await stopTestDatabase(db);
    process.env.DATABASE_URL = originalDatabaseUrl;
  });

  afterEach(async () => {
    await resetTestDatabase(db);
  });

  async function insertParentAndProfile(): Promise<{ parentUserId: string; playerProfileId: string }> {
    const parentUserId = randomUUID();
    await prismaService.user.create({
      data: { id: parentUserId, email: `${parentUserId}@example.com`, passwordHash: 'hash', role: 'PLAYER_PARENT', firstName: 'A', lastName: 'B' },
    });
    const profile = await prismaService.playerProfile.create({
      data: { accountUserId: parentUserId, name: 'Kid', dateOfBirth: new Date('2016-01-01'), gender: 'MALE', isSelf: false },
    });
    return { parentUserId, playerProfileId: profile.id };
  }

  it('creates a PENDING row defaulting expiresAt to 48h from now', async () => {
    const { parentUserId, playerProfileId } = await insertParentAndProfile();
    const before = Date.now();

    const created = await service.createRequest({
      playerProfileId,
      parentUserId,
      eventId: randomUUID(),
      amount: '10.00',
      paymentType: 'USD',
    });

    expect(created.status).toBe('PENDING');
    const expiresInMs = created.expiresAt.getTime() - before;
    expect(expiresInMs).toBeGreaterThan(47 * 60 * 60 * 1000);
    expect(expiresInMs).toBeLessThan(49 * 60 * 60 * 1000);
  });

  it('honors an explicit expiresAt when supplied', async () => {
    const { parentUserId, playerProfileId } = await insertParentAndProfile();
    const explicitExpiry = new Date(Date.now() + 60_000);

    const created = await service.createRequest({
      playerProfileId,
      parentUserId,
      eventId: randomUUID(),
      amount: '10.00',
      paymentType: 'TOKEN',
      expiresAt: explicitExpiry,
    });

    expect(created.expiresAt.toISOString()).toBe(explicitExpiry.toISOString());
  });
});
