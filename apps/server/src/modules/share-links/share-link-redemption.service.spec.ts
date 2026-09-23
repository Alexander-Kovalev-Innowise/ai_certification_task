import { randomUUID } from 'node:crypto';

import type { Request, Response } from 'express';

import {
  resetTestDatabase,
  startTestDatabase,
  stopTestDatabase,
  TestDatabase,
} from '../../../test/setup/testcontainers.setup';

// Task 4.6, extended in Task 4.9 (COACH_ACCEPT single-use atomicity).
// Testcontainers-backed (like trainer.service.spec.ts /
// account-provisioning.service.spec.ts) — proves the actual atomicity claims
// ("one $transaction... a forced failure after the User insert leaves
// nothing behind", "two concurrent requests, exactly one succeeds"), which a
// mocked Prisma client cannot meaningfully demonstrate. Full HTTP-level
// coverage (real cookies, response shape) lives in
// test/share-links.e2e-spec.ts; this file is narrowly about transaction
// boundaries, same division of labor trainer.service.spec.ts documents for
// Task 3.8.
//
// Deliberately ONE top-level `describe`/container for the whole file, not
// one per task: `shared/config/config.module.ts`'s `env` (read once, at
// first `require`/`import`, and cached by Node's module registry) freezes
// `DATABASE_URL` to whatever `process.env.DATABASE_URL` was at that moment —
// which is why EVERY require of anything that transitively pulls in
// `config.module.ts` (including this file's own top-level imports) must stay
// deferred until AFTER `beforeAll` overwrites `process.env.DATABASE_URL`
// with the fresh Testcontainers container's URI. A stray top-level
// `import { env } from '.../config.module'` (even just for `JWT_SECRET`,
// nothing to do with the database) was enough to poison the cache and make
// every later dynamic `require('.../prisma.service')` silently reconnect to
// whatever `DATABASE_URL` was already in the environment before this file
// ran — discovered the hard way while adding Task 4.9's tests here. `env` is
// therefore obtained via the same deferred `require(...)` as everything else
// below, never a static import.
describe('ShareLinkRedemptionService.redeem (Tasks 4.6, 4.9)', () => {
  jest.setTimeout(180_000);

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
  // Set inside `beforeAll` (see the file-level comment on why `env` cannot
  // be a top-level import). `resolveOptionalAuthContext`
  // (share-link-redemption.service.ts) verifies against `env.JWT_SECRET`
  // explicitly, not whatever secret a given `JwtService` instance happens to
  // be constructed with — every token this file signs must use the same
  // real app secret, not an arbitrary test-only string, or verification
  // fails with a misleading 401.
  let SHARED_SECRET: string;

  beforeAll(async () => {
    db = await startTestDatabase();
    process.env.DATABASE_URL = db.connectionUri;

    /* eslint-disable @typescript-eslint/no-require-imports -- deliberate, defers evaluation until after DATABASE_URL is set */
    const { env } = require('../../shared/config/config.module') as typeof import('../../shared/config/config.module');
    SHARED_SECRET = env.JWT_SECRET;
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

    const jwtService = new JwtService({ secret: SHARED_SECRET });
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
      usersRepository,
      prismaService,
    );
  }

  async function seedTrainer(): Promise<{ trainerId: string; trainerUserId: string }> {
    const trainerUserId = randomUUID();
    await prismaService.user.create({
      data: { id: trainerUserId, email: `${trainerUserId}@example.com`, passwordHash: 'x', role: 'TRAINER', firstName: 'T', lastName: 'R', status: 'ACTIVE' },
    });
    const trainerId = randomUUID();
    await prismaService.trainerProfile.create({ data: { id: trainerId, userId: trainerUserId, businessName: 'Acme Co' } });
    return { trainerId, trainerUserId };
  }

  async function seedPlayerStaticLink(): Promise<{ code: string; id: string; trainerId: string }> {
    const { trainerId, trainerUserId } = await seedTrainer();
    const link = await prismaService.shareLink.create({
      data: { code: randomUUID(), type: 'PLAYER_STATIC', trainerId, createdByUserId: trainerUserId },
    });
    return { code: link.code, id: link.id, trainerId };
  }

  async function seedCoachUniqueLink(targetEmail: string): Promise<{ code: string; trainerId: string }> {
    const { trainerId, trainerUserId } = await seedTrainer();
    const link = await prismaService.shareLink.create({
      data: {
        code: randomUUID(),
        type: 'COACH_UNIQUE',
        trainerId,
        createdByUserId: trainerUserId,
        targetEmail,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    return { code: link.code, trainerId };
  }

  async function seedCoachUser(status: 'PENDING' | 'ACTIVE' | null): Promise<{ userId: string; email: string }> {
    const userId = randomUUID();
    const email = `${userId}@example.com`;
    await prismaService.user.create({
      data: { id: userId, email, passwordHash: 'x', role: 'COACH', firstName: 'C', lastName: 'O', status: 'ACTIVE' },
    });
    if (status) {
      const { trainerId } = await seedTrainer();
      await prismaService.coachProfile.create({ data: { userId, trainerId, status } });
    }
    return { userId, email };
  }

  async function signAccessToken(sub: string, role: string): Promise<string> {
    const jwtService = new JwtService({ secret: SHARED_SECRET });
    return jwtService.signAsync(
      { sub, role, typ: 'ADULT', gid: null, tid: null, tv: 0, jti: randomUUID() },
      { expiresIn: '15m' },
    );
  }

  function fakeReqRes(): { req: Request; res: Response } {
    const req = { headers: {} } as unknown as Request;
    const res = { cookie: () => res, clearCookie: () => res } as unknown as Response;
    return { req, res };
  }

  function fakeAuthedReqRes(token: string): { req: Request; res: Response } {
    const req = { headers: { authorization: `Bearer ${token}` } } as unknown as Request;
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

  describe('ANONYMOUS_REGISTRATION (Task 4.6)', () => {
    it('creates User + PlayerProfile + PlayerTrainerAssociation + increments useCount + enqueues the confirmation email, all in one commit', async () => {
      const service = buildService();
      const link = await seedPlayerStaticLink();
      const dto = baseDto();
      const { req, res } = fakeReqRes();

      const result = await service.redeem(link.code, dto, req, res);

      expect(result.statusCode).toBe(201);
      expect(result.body.accessToken).toEqual(expect.any(String));
      expect(result.body.user.email).toBe(dto.email);

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

  // Task 4.9 (BR-006, race-condition-critical). Specifically about the
  // conditional `updateMany`'s atomicity under real concurrent Postgres
  // transactions, which a mocked Prisma client cannot demonstrate at all.
  describe('COACH_ACCEPT (Task 4.9)', () => {
    it('ShareLinksRepository.claimSingleUse: two concurrent claims on the same code — exactly one gets count===1, the other count===0', async () => {
      const link = await seedCoachUniqueLink(`${randomUUID()}@example.com`);
      const shareLinksRepository = new ShareLinksRepository(prismaService);

      const [resultA, resultB] = await Promise.all([
        prismaService.$transaction((tx: unknown) => shareLinksRepository.claimSingleUse(link.code, tx)),
        prismaService.$transaction((tx: unknown) => shareLinksRepository.claimSingleUse(link.code, tx)),
      ]);

      const counts = [resultA.count, resultB.count].sort();
      expect(counts).toEqual([0, 1]);

      const refreshedLink = await prismaService.shareLink.findFirst({ where: { code: link.code } });
      expect(refreshedLink.useCount).toBe(1);
      expect(refreshedLink.status).toBe('EXPIRED');
    });

    it('two concurrent authenticated redemptions of the same single-use link: exactly one succeeds, the other is rejected, and only one CoachProfile ends up ACTIVE', async () => {
      const coach = await seedCoachUser('PENDING');
      const link = await seedCoachUniqueLink(coach.email);
      const service = buildService();
      const token = await signAccessToken(coach.userId, 'COACH');
      const { req: req1, res: res1 } = fakeAuthedReqRes(token);
      const { req: req2, res: res2 } = fakeAuthedReqRes(token);

      const [outcomeA, outcomeB] = await Promise.allSettled([
        service.redeem(link.code, {}, req1, res1),
        service.redeem(link.code, {}, req2, res2),
      ]);

      const fulfilled = [outcomeA, outcomeB].filter((o) => o.status === 'fulfilled');
      const rejected = [outcomeA, outcomeB].filter((o) => o.status === 'rejected');
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);

      // The loser's exact errorCode depends on real execution timing: it
      // either loses the atomic claim itself (SHARE_LINK_UNAVAILABLE) or —
      // if the winner's whole transaction already committed by the time the
      // loser's (deliberately non-atomic, see redeemCoachAcceptAuthenticated's
      // own comment) BR-003 pre-check runs — sees the now-ACTIVE CoachProfile
      // first (CONFLICT). Both are correct rejections of the same underlying
      // race; the DB end-state assertions below are what actually prove
      // single-use atomicity (BR-006) deterministically, same as the
      // repository-level test above.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- narrowed by the length assertion above
      expect(['SHARE_LINK_UNAVAILABLE', 'CONFLICT']).toContain((rejected[0] as any).reason.response.errorCode);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((fulfilled[0] as any).value.statusCode).toBe(200);

      const refreshedLink = await prismaService.shareLink.findFirst({ where: { code: link.code } });
      expect(refreshedLink.useCount).toBe(1);
      expect(refreshedLink.status).toBe('EXPIRED');

      const coachProfile = await prismaService.coachProfile.findUnique({ where: { userId: coach.userId } });
      expect(coachProfile.status).toBe('ACTIVE');
      expect(coachProfile.trainerId).toBe(link.trainerId);
    });

    it('a coach already ACTIVE elsewhere is rejected (BR-003), link is never claimed', async () => {
      const coach = await seedCoachUser('ACTIVE');
      const link = await seedCoachUniqueLink(coach.email);
      const service = buildService();
      const token = await signAccessToken(coach.userId, 'COACH');
      const { req, res } = fakeAuthedReqRes(token);

      await expect(service.redeem(link.code, {}, req, res)).rejects.toMatchObject({ response: { errorCode: 'CONFLICT' } });

      const refreshedLink = await prismaService.shareLink.findFirst({ where: { code: link.code } });
      expect(refreshedLink.useCount).toBe(0);
      expect(refreshedLink.status).toBe('ACTIVE');
    });
  });
});
