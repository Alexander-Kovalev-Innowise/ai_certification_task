import { randomUUID } from 'node:crypto';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import request from 'supertest';

import { resetTestDatabase, startTestDatabase, stopTestDatabase, TestDatabase } from './setup/testcontainers.setup';

// Task 4.2, first endpoint — extended by every later share-links task
// (4.3-4.10, 4.14) rather than re-created, same convention
// trainers.e2e-spec.ts already established.
describe('ShareLinksController (e2e, Task 4.2)', () => {
  jest.setTimeout(180_000);

  let db: TestDatabase;
  let app: INestApplication;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamically required after DATABASE_URL is set
  let jwtService: any;

  const originalDatabaseUrl = process.env.DATABASE_URL;
  const KNOWN_PASSWORD = 'CorrectHorseBattery1';

  beforeAll(async () => {
    db = await startTestDatabase();
    process.env.DATABASE_URL = db.connectionUri;

    /* eslint-disable @typescript-eslint/no-require-imports -- deliberate, defers evaluation until after DATABASE_URL is set */
    const { AppModule } = require('../src/app.module') as typeof import('../src/app.module');
    const { GlobalExceptionFilter } = require('../src/shared/http/global-exception.filter') as typeof import('../src/shared/http/global-exception.filter');
    const { JwtService } = require('@nestjs/jwt') as typeof import('@nestjs/jwt');
    /* eslint-enable @typescript-eslint/no-require-imports */

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(helmet());
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();

    jwtService = moduleRef.get(JwtService);
  });

  afterAll(async () => {
    await app?.close();
    await stopTestDatabase(db);
    process.env.DATABASE_URL = originalDatabaseUrl;
  });

  afterEach(async () => {
    await resetTestDatabase(db);
  });

  async function insertUser(overrides: Record<string, unknown> = {}): Promise<{ id: string; email: string; role: string }> {
    const id = randomUUID();
    const email = (overrides.email as string | undefined) ?? `${id}@example.com`;
    const role = (overrides.role as string | undefined) ?? 'PLAYER_PARENT';
    await db.prisma.user.create({
      data: {
        id,
        email,
        passwordHash: await argon2.hash(KNOWN_PASSWORD),
        role,
        firstName: 'A',
        lastName: 'B',
        status: 'ACTIVE',
        ...overrides,
        email,
        role,
      },
    });
    return { id, email, role };
  }

  // Direct JWT signing, not /auth/login — see users.e2e-spec.ts's identical
  // helper/comment for why (auth-ip throttler budget across a growing file).
  function signToken(user: { id: string; role: string }, extra: Record<string, unknown> = {}): Promise<string> {
    return jwtService.signAsync(
      { sub: user.id, role: user.role, typ: 'ADULT', gid: null, tid: null, tv: 0, jti: randomUUID(), ...extra },
      { expiresIn: '15m' },
    );
  }

  /** Seeds a TRAINER User + TrainerProfile directly, returning both plus a ready-to-use access token. */
  async function insertTrainer(overrides: Record<string, unknown> = {}): Promise<{
    userId: string;
    trainerId: string;
    accessToken: string;
  }> {
    const user = await insertUser({ role: 'TRAINER' });
    const trainerId = randomUUID();
    await db.prisma.trainerProfile.create({
      data: { id: trainerId, userId: user.id, businessName: 'Original Co', ...overrides },
    });
    const accessToken = await signToken(user, { role: 'TRAINER', tid: trainerId });
    return { userId: user.id, trainerId, accessToken };
  }

  describe('POST /share-links (Task 4.2)', () => {
    it('creates a PLAYER_STATIC link with null expiry/uses', async () => {
      const trainer = await insertTrainer();

      const res = await request(app.getHttpServer())
        .post('/share-links')
        .set('Authorization', `Bearer ${trainer.accessToken}`)
        .send({ type: 'PLAYER_STATIC' });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ type: 'PLAYER_STATIC', status: 'ACTIVE' });
      expect(res.body.expiresAt).toBeNull();
      expect(res.body.joinUrl).toBe(`/join/${res.body.code}`);

      const row = await db.prisma.shareLink.findUnique({ where: { id: res.body.id } });
      expect(row?.expiresAt).toBeNull();
      expect(row?.maxUses).toBeNull();
      expect(row?.trainerId).toBe(trainer.trainerId);
    });

    it('COACH_UNIQUE without targetEmail -> 400 VALIDATION_ERROR', async () => {
      const trainer = await insertTrainer();

      const res = await request(app.getHttpServer())
        .post('/share-links')
        .set('Authorization', `Bearer ${trainer.accessToken}`)
        .send({ type: 'COACH_UNIQUE' });

      expect(res.status).toBe(400);
      expect(res.body.errorCode).toBe('VALIDATION_ERROR');
    });

    it('creates a COACH_UNIQUE link with a 7-day expiry and the given targetEmail', async () => {
      const trainer = await insertTrainer();

      const res = await request(app.getHttpServer())
        .post('/share-links')
        .set('Authorization', `Bearer ${trainer.accessToken}`)
        .send({ type: 'COACH_UNIQUE', targetEmail: 'coach@example.com' });

      expect(res.status).toBe(201);
      expect(res.body.type).toBe('COACH_UNIQUE');
      expect(res.body.expiresAt).not.toBeNull();

      const row = await db.prisma.shareLink.findUnique({ where: { id: res.body.id } });
      expect(row?.targetEmail).toBe('coach@example.com');
    });

    it('as a non-trainer role -> 403', async () => {
      const user = await insertUser();
      const accessToken = await signToken(user);

      const res = await request(app.getHttpServer())
        .post('/share-links')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ type: 'PLAYER_STATIC' });

      expect(res.status).toBe(403);
    });
  });

  describe('GET /share-links/:code (Task 4.3, public preview)', () => {
    it('unknown code -> 200 {valid:false, reason:NOT_FOUND} (never 404)', async () => {
      const res = await request(app.getHttpServer()).get('/share-links/does-not-exist');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ valid: false, reason: 'NOT_FOUND' });
    });

    it('valid ACTIVE link -> 200 {valid:true, ...branding}, no PII/internal ids', async () => {
      const trainer = await insertTrainer({ businessName: 'Acme Co', logoUrl: 'https://cdn.example.com/logo.png', primaryColorHex: '#112233' });
      const link = await db.prisma.shareLink.create({
        data: { code: 'valid-code', type: 'PLAYER_STATIC', trainerId: trainer.trainerId, createdByUserId: trainer.userId },
      });

      const res = await request(app.getHttpServer()).get(`/share-links/${link.code}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        valid: true,
        type: 'PLAYER_STATIC',
        trainerDisplayName: 'Acme Co',
        logoUrl: 'https://cdn.example.com/logo.png',
        primaryColorHex: '#112233',
      });
      expect(res.body.trainerId).toBeUndefined();
      expect(res.body.id).toBeUndefined();
    });

    it('revoked link -> 200 {valid:false, reason:REVOKED}', async () => {
      const trainer = await insertTrainer();
      const link = await db.prisma.shareLink.create({
        data: { code: 'revoked-code', type: 'PLAYER_STATIC', trainerId: trainer.trainerId, createdByUserId: trainer.userId, status: 'REVOKED' },
      });

      const res = await request(app.getHttpServer()).get(`/share-links/${link.code}`);

      expect(res.body).toMatchObject({ valid: false, reason: 'REVOKED' });
    });

    it('expired link (status EXPIRED) -> 200 {valid:false, reason:EXPIRED}', async () => {
      const trainer = await insertTrainer();
      const link = await db.prisma.shareLink.create({
        data: { code: 'expired-code', type: 'COACH_UNIQUE', trainerId: trainer.trainerId, createdByUserId: trainer.userId, status: 'EXPIRED' },
      });

      const res = await request(app.getHttpServer()).get(`/share-links/${link.code}`);

      expect(res.body).toMatchObject({ valid: false, reason: 'EXPIRED' });
    });

    it('ACTIVE link past its expiresAt (maintenance-sweep lag) -> 200 {valid:false, reason:EXPIRED}', async () => {
      const trainer = await insertTrainer();
      const link = await db.prisma.shareLink.create({
        data: {
          code: 'lagging-expiry-code',
          type: 'COACH_UNIQUE',
          trainerId: trainer.trainerId,
          createdByUserId: trainer.userId,
          expiresAt: new Date(Date.now() - 60_000),
        },
      });

      const res = await request(app.getHttpServer()).get(`/share-links/${link.code}`);

      expect(res.body).toMatchObject({ valid: false, reason: 'EXPIRED' });
    });

    it('exhausted link (useCount >= maxUses) -> 200 {valid:false, reason:EXHAUSTED}', async () => {
      const trainer = await insertTrainer();
      const link = await db.prisma.shareLink.create({
        data: {
          code: 'exhausted-code',
          type: 'PLAYER_STATIC',
          trainerId: trainer.trainerId,
          createdByUserId: trainer.userId,
          maxUses: 1,
          useCount: 1,
        },
      });

      const res = await request(app.getHttpServer()).get(`/share-links/${link.code}`);

      expect(res.body).toMatchObject({ valid: false, reason: 'EXHAUSTED' });
    });
  });

  describe('GET /trainers/:id/share-links (Task 4.4)', () => {
    it('lists the trainer’s own links with usage counts', async () => {
      const trainer = await insertTrainer();
      await db.prisma.shareLink.create({
        data: {
          code: 'row-1',
          type: 'PLAYER_STATIC',
          trainerId: trainer.trainerId,
          createdByUserId: trainer.userId,
          useCount: 3,
        },
      });
      await db.prisma.shareLink.create({
        data: {
          code: 'row-2',
          type: 'COACH_UNIQUE',
          trainerId: trainer.trainerId,
          createdByUserId: trainer.userId,
          targetEmail: 'coach@example.com',
        },
      });

      const res = await request(app.getHttpServer())
        .get(`/trainers/${trainer.trainerId}/share-links`)
        .set('Authorization', `Bearer ${trainer.accessToken}`);

      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(2);
      const row1 = res.body.items.find((r: { code: string }) => r.code === 'row-1');
      expect(row1).toMatchObject({ code: 'row-1', type: 'PLAYER_STATIC', useCount: 3, status: 'ACTIVE' });
      const row2 = res.body.items.find((r: { code: string }) => r.code === 'row-2');
      expect(row2).toMatchObject({ code: 'row-2', type: 'COACH_UNIQUE', targetEmail: 'coach@example.com' });
    });

    it('cross-tenant -> 404 (never 403, arch §8 Layer 3)', async () => {
      const trainerA = await insertTrainer();
      const trainerB = await insertTrainer();
      await db.prisma.shareLink.create({
        data: { code: 'a-only', type: 'PLAYER_STATIC', trainerId: trainerA.trainerId, createdByUserId: trainerA.userId },
      });

      const res = await request(app.getHttpServer())
        .get(`/trainers/${trainerA.trainerId}/share-links`)
        .set('Authorization', `Bearer ${trainerB.accessToken}`);

      expect(res.status).toBe(404);
      expect(res.body.errorCode).toBe('NOT_FOUND');
    });

    it('Super Admin can list any trainer’s links', async () => {
      const admin = await insertUser({ role: 'SUPER_ADMIN' });
      const adminToken = await signToken(admin);
      const trainer = await insertTrainer();
      await db.prisma.shareLink.create({
        data: { code: 'sa-visible', type: 'PLAYER_STATIC', trainerId: trainer.trainerId, createdByUserId: trainer.userId },
      });

      const res = await request(app.getHttpServer())
        .get(`/trainers/${trainer.trainerId}/share-links`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(1);
    });
  });

  describe('DELETE /share-links/:id (Task 4.5)', () => {
    it('soft-revokes the link, and its preview now reports REVOKED', async () => {
      const trainer = await insertTrainer();
      const link = await db.prisma.shareLink.create({
        data: { code: 'to-revoke', type: 'PLAYER_STATIC', trainerId: trainer.trainerId, createdByUserId: trainer.userId },
      });

      const res = await request(app.getHttpServer())
        .delete(`/share-links/${link.id}`)
        .set('Authorization', `Bearer ${trainer.accessToken}`);

      expect(res.status).toBe(204);

      const row = await db.prisma.shareLink.findUnique({ where: { id: link.id } });
      expect(row?.status).toBe('REVOKED');

      const previewRes = await request(app.getHttpServer()).get(`/share-links/${link.code}`);
      expect(previewRes.body).toMatchObject({ valid: false, reason: 'REVOKED' });
    });

    it('cross-tenant -> 404, and leaves the link untouched', async () => {
      const trainerA = await insertTrainer();
      const trainerB = await insertTrainer();
      const link = await db.prisma.shareLink.create({
        data: { code: 'a-owned', type: 'PLAYER_STATIC', trainerId: trainerA.trainerId, createdByUserId: trainerA.userId },
      });

      const res = await request(app.getHttpServer())
        .delete(`/share-links/${link.id}`)
        .set('Authorization', `Bearer ${trainerB.accessToken}`);

      expect(res.status).toBe(404);

      const row = await db.prisma.shareLink.findUnique({ where: { id: link.id } });
      expect(row?.status).toBe('ACTIVE');
    });

    it('unknown id -> 404', async () => {
      const trainer = await insertTrainer();

      const res = await request(app.getHttpServer())
        .delete(`/share-links/${randomUUID()}`)
        .set('Authorization', `Bearer ${trainer.accessToken}`);

      expect(res.status).toBe(404);
    });

    it('Super Admin can revoke any trainer’s link', async () => {
      const admin = await insertUser({ role: 'SUPER_ADMIN' });
      const adminToken = await signToken(admin);
      const trainer = await insertTrainer();
      const link = await db.prisma.shareLink.create({
        data: { code: 'sa-revoke', type: 'PLAYER_STATIC', trainerId: trainer.trainerId, createdByUserId: trainer.userId },
      });

      const res = await request(app.getHttpServer())
        .delete(`/share-links/${link.id}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(204);
      const row = await db.prisma.shareLink.findUnique({ where: { id: link.id } });
      expect(row?.status).toBe('REVOKED');
    });
  });

  describe('POST /share-links/:code/redeem — ANONYMOUS_REGISTRATION (Task 4.6)', () => {
    async function seedPlayerStaticLink(): Promise<{ code: string; trainerId: string }> {
      const trainer = await insertTrainer({ businessName: 'Redeem Co' });
      const link = await db.prisma.shareLink.create({
        data: { code: `redeem-${randomUUID()}`, type: 'PLAYER_STATIC', trainerId: trainer.trainerId, createdByUserId: trainer.userId },
      });
      return { code: link.code, trainerId: trainer.trainerId };
    }

    function redeemDto(overrides: Record<string, unknown> = {}) {
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

    it('no auth header, PLAYER_STATIC link -> 201 auto-login session; creates User+PlayerProfile+PlayerTrainerAssociation, increments useCount', async () => {
      const link = await seedPlayerStaticLink();
      const dto = redeemDto();

      const res = await request(app.getHttpServer()).post(`/share-links/${link.code}/redeem`).send(dto);

      expect(res.status).toBe(201);
      expect(res.body.accessToken).toEqual(expect.any(String));
      expect(res.body.user).toMatchObject({ email: dto.email, role: 'PLAYER_PARENT' });
      expect(res.headers['set-cookie']).toBeDefined();

      const user = await db.prisma.user.findUnique({ where: { email: dto.email } });
      expect(user).not.toBeNull();

      const profile = await db.prisma.playerProfile.findFirst({ where: { accountUserId: user!.id } });
      expect(profile).not.toBeNull();
      expect(profile?.name).toBe(dto.playerName);

      const association = await db.prisma.playerTrainerAssociation.findFirst({
        where: { trainerId: link.trainerId, playerProfileId: profile!.id },
      });
      expect(association?.status).toBe('ACTIVE');

      const refreshedLink = await db.prisma.shareLink.findUnique({ where: { code: link.code } });
      expect(refreshedLink?.useCount).toBe(1);

      const jobs = await db.prisma.outboxJob.findMany({ where: { type: 'EMAIL_SHARELINK_CONFIRMATION' } });
      expect(jobs).toHaveLength(1);
    });

    it('missing a required field -> 400 VALIDATION_ERROR', async () => {
      const link = await seedPlayerStaticLink();
      const dto = redeemDto();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- intentionally deleting a required field to prove server-side validation
      delete (dto as any).playerName;

      const res = await request(app.getHttpServer()).post(`/share-links/${link.code}/redeem`).send(dto);

      expect(res.status).toBe(400);
      expect(res.body.errorCode).toBe('VALIDATION_ERROR');
    });

    it('revoked link -> 409 SHARE_LINK_UNAVAILABLE', async () => {
      const trainer = await insertTrainer();
      const link = await db.prisma.shareLink.create({
        data: { code: `revoked-redeem-${randomUUID()}`, type: 'PLAYER_STATIC', trainerId: trainer.trainerId, createdByUserId: trainer.userId, status: 'REVOKED' },
      });

      const res = await request(app.getHttpServer()).post(`/share-links/${link.code}/redeem`).send(redeemDto());

      expect(res.status).toBe(409);
      expect(res.body.errorCode).toBe('SHARE_LINK_UNAVAILABLE');
    });

    it('unknown code -> 404', async () => {
      const res = await request(app.getHttpServer()).post('/share-links/does-not-exist/redeem').send(redeemDto());

      expect(res.status).toBe(404);
      expect(res.body.errorCode).toBe('NOT_FOUND');
    });
  });
});
