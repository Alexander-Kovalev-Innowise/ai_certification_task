import { randomUUID } from 'node:crypto';

import type { Request, Response } from 'express';

import {
  resetTestDatabase,
  startTestDatabase,
  stopTestDatabase,
  TestDatabase,
} from '../../../test/setup/testcontainers.setup';

// Task 4.6. Testcontainers-backed (like trainer.service.spec.ts /
// account-provisioning.service.spec.ts) — proves the actual atomicity claim
// ("one $transaction... a forced failure after the User insert leaves
// nothing behind"), which a mocked Prisma client cannot meaningfully
// demonstrate. Full HTTP-level coverage (real cookies, response shape) lives
// in test/share-links.e2e-spec.ts; this file is narrowly about the
// transaction boundary, same division of labor trainer.service.spec.ts
// documents for Task 3.8.
describe('ShareLinkRedemptionService.redeem — ANONYMOUS_REGISTRATION (Task 4.6)', () => {
  jest.setTimeout(120_000);

  let db: TestDatabase;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamically required after DATABASE_URL is set, see beforeAll
  let prismaService: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let ShareLinkRedemptionService: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let ShareLinksRepository: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let AssociationsRepository: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let AccountProvisioningService: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let UsersRepository: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let PasswordService: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let OutboxService: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let OutboxRepository: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let AuthService: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let TokenService: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let TokenRotationService: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let RefreshTokenRepository: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let PasswordResetTokenRepository: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let EmailVerificationTokenRepository: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let AuthSnapshotRepository: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let JwtService: any;

  const originalDatabaseUrl = process.env.DATABASE_URL;

  beforeAll(async () => {
    db = await startTestDatabase();
    process.env.DATABASE_URL = db.connectionUri;

    /* eslint-disable @typescript-eslint/no-require-imports -- deliberate, defers evaluation until after DATABASE_URL is set */
    const prismaModule = require('../../shared/prisma/prisma.service') as typeof import('../../shared/prisma/prisma.service');
    ({ UsersRepository } = require('../users/users.repository') as typeof import('../users/users.repository'));
    ({ AccountProvisioningService } = require('../users/account-provisioning.service') as typeof import('../users/account-provisioning.service'));
    ({ AssociationsRepository } = require('../associations/associations.repository') as typeof import('../associations/associations.repository'));
    ({ PasswordService } = require('../auth/password.service') as typeof import('../auth/password.service'));
    ({ TokenService } = require('../auth/token.service') as typeof import('../auth/token.service'));
    ({ TokenRotationService } = require('../auth/token-rotation.service') as typeof import('../auth/token-rotation.service'));
    ({ RefreshTokenRepository } = require('../auth/refresh-token.repository') as typeof import('../auth/refresh-token.repository'));
    ({ PasswordResetTokenRepository } = require('../auth/password-reset-token.repository') as typeof import('../auth/password-reset-token.repository'));
    ({ EmailVerificationTokenRepository } = require('../auth/email-verification-token.repository') as typeof import('../auth/email-verification-token.repository'));
    ({ AuthService } = require('../auth/auth.service') as typeof import('../auth/auth.service'));
    ({ AuthSnapshotRepository } = require('../../shared/security/auth-snapshot.repository') as typeof import('../../shared/security/auth-snapshot.repository'));
    ({ JwtService } = require('@nestjs/jwt') as typeof import('@nestjs/jwt'));
    ({ ShareLinksRepository } = require('./share-links.repository') as typeof import('./share-links.repository'));
    ({ ShareLinkRedemptionService } = require('./share-link-redemption.service') as typeof import('./share-link-redemption.service'));
    ({ OutboxRepository } = require('../../shared/jobs/outbox.repository') as typeof import('../../shared/jobs/outbox.repository'));
    ({ OutboxService } = require('../../shared/jobs/outbox.service') as typeof import('../../shared/jobs/outbox.service'));
    /* eslint-enable @typescript-eslint/no-require-imports */

    prismaService = new prismaModule.PrismaService();
    await prismaService.onModuleInit();
  });

  afterAll(async () => {
    await prismaService?.onModuleDestroy();
    await stopTestDatabase(db);
    process.env.DATABASE_URL = originalDatabaseUrl;
  });

  afterEach(async () => {
    await resetTestDatabase(db);
  });

  function buildService(outboxServiceOverride?: unknown) {
    const usersRepository = new UsersRepository(prismaService);
    const accountProvisioningService = new AccountProvisioningService(prismaService, usersRepository);
    const associationsRepository = new AssociationsRepository(prismaService);
    const shareLinksRepository = new ShareLinksRepository(prismaService);
    const passwordService = new PasswordService();
    const outboxRepository = new OutboxRepository(prismaService);
    const outboxService = outboxServiceOverride ?? new OutboxService(prismaService, outboxRepository, {} as never, {} as never);

    const jwtService = new JwtService({ secret: 'test-secret' });
    const authSnapshotRepository = new AuthSnapshotRepository(prismaService);
    const tokenService = new TokenService(jwtService);
    const refreshTokenRepository = new RefreshTokenRepository(prismaService);
    const tokenRotationService = new TokenRotationService(prismaService, refreshTokenRepository, usersRepository);
    const passwordResetTokenRepository = new PasswordResetTokenRepository(prismaService);
    const emailVerificationTokenRepository = new EmailVerificationTokenRepository(prismaService);
    const authService = new AuthService(
      prismaService,
      usersRepository,
      passwordService,
      tokenService,
      tokenRotationService,
      refreshTokenRepository,
      passwordResetTokenRepository,
      emailVerificationTokenRepository,
      outboxService,
    );

    return new ShareLinkRedemptionService(
      shareLinksRepository,
      associationsRepository,
      accountProvisioningService,
      passwordService,
      outboxService,
      authService,
      jwtService,
      authSnapshotRepository,
    );
  }

  async function seedPlayerStaticLink(): Promise<{ code: string; id: string; trainerId: string }> {
    const trainerUserId = randomUUID();
    await prismaService.user.create({
      data: { id: trainerUserId, email: `${trainerUserId}@example.com`, passwordHash: 'x', role: 'TRAINER', firstName: 'T', lastName: 'R', status: 'ACTIVE' },
    });
    const trainerId = randomUUID();
    await prismaService.trainerProfile.create({ data: { id: trainerId, userId: trainerUserId, businessName: 'Acme Co' } });
    const link = await prismaService.shareLink.create({
      data: { code: randomUUID(), type: 'PLAYER_STATIC', trainerId, createdByUserId: trainerUserId },
    });
    return { code: link.code, id: link.id, trainerId };
  }

  function fakeReqRes(): { req: Request; res: Response } {
    const req = { headers: {} } as unknown as Request;
    const res = { cookie: () => res, clearCookie: () => res } as unknown as Response;
    return { req, res };
  }

  function baseDto(overrides: Record<string, unknown> = {}) {
    return {
      email: `${randomUUID()}@example.com`,
      password: 'Password1',
      phone: '+14155552671',
      playerName: 'Jamie Doe',
      dateOfBirth: '2015-01-01',
      gender: 'OTHER',
      isSelf: false,
      ...overrides,
    };
  }

  it('creates User + PlayerProfile + PlayerTrainerAssociation + increments useCount + enqueues the confirmation email, all in one commit', async () => {
    const service = buildService();
    const link = await seedPlayerStaticLink();
    const dto = baseDto();
    const { req, res } = fakeReqRes();

    const session = await service.redeem(link.code, dto, req, res);

    expect(session.accessToken).toEqual(expect.any(String));
    expect(session.user.email).toBe(dto.email);

    const user = await prismaService.user.findUnique({ where: { email: dto.email } });
    expect(user).not.toBeNull();
    expect(user.role).toBe('PLAYER_PARENT');

    const profile = await prismaService.playerProfile.findFirst({ where: { accountUserId: user.id } });
    expect(profile).not.toBeNull();
    expect(profile.name).toBe(dto.playerName);
    expect(profile.isSelf).toBe(false);

    const association = await prismaService.playerTrainerAssociation.findFirst({
      where: { trainerId: link.trainerId, playerProfileId: profile.id },
    });
    expect(association).not.toBeNull();
    expect(association.status).toBe('ACTIVE');

    const refreshed = await prismaService.shareLink.findUnique({ where: { id: link.id } });
    expect(refreshed.useCount).toBe(1);

    const jobs = await prismaService.outboxJob.findMany({ where: { type: 'EMAIL_SHARELINK_CONFIRMATION' } });
    expect(jobs).toHaveLength(1);
    expect(jobs[0].payload).toMatchObject({ to: dto.email });
  });

  it('leaves no User/PlayerProfile/association row when the afterCreate step (outbox enqueue) fails partway through', async () => {
    const failingOutboxService = { enqueue: async () => { throw new Error('simulated outbox failure'); } };
    const service = buildService(failingOutboxService);
    const link = await seedPlayerStaticLink();
    const dto = baseDto();
    const { req, res } = fakeReqRes();

    await expect(service.redeem(link.code, dto, req, res)).rejects.toThrow('simulated outbox failure');

    const user = await prismaService.user.findUnique({ where: { email: dto.email } });
    expect(user).toBeNull();
    const profiles = await prismaService.playerProfile.findMany({});
    expect(profiles).toHaveLength(0);
    const associations = await prismaService.playerTrainerAssociation.findMany({});
    expect(associations).toHaveLength(0);
    const refreshed = await prismaService.shareLink.findUnique({ where: { id: link.id } });
    expect(refreshed.useCount).toBe(0);
  });
});
