import { randomUUID } from 'node:crypto';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import request from 'supertest';

import { resetTestDatabase, startTestDatabase, stopTestDatabase, TestDatabase } from './setup/testcontainers.setup';

// Task 7.1, extended through Phase 7 (Tasks 7.2/7.3/7.5/7.6) — same e2e
// convention every other phase's spec file already established. Per the
// plan's own pitfall note: callers' OWN tokens are signed directly
// (signToken helper below, the established `test/helpers` pattern), never
// minted via repeated `/auth/login` calls — the one deliberate exception is
// Task 7.6's full round trip, which genuinely needs a real `/auth/login` +
// real refresh cookie for the admin, since that IS the mechanism under test.
describe('ImpersonationController (e2e, Phase 7)', () => {
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

  async function insertUser(overrides: Record<string, unknown> = {}): Promise<{ id: string; email: string; role: string; tokenVersion: number }> {
    const id = randomUUID();
    const email = (overrides.email as string | undefined) ?? `${id}@example.com`;
    const role = (overrides.role as string | undefined) ?? 'PLAYER_PARENT';
    const tokenVersion = (overrides.tokenVersion as number | undefined) ?? 0;
    await db.prisma.user.create({
      data: {
        id,
        email,
        passwordHash: await argon2.hash(KNOWN_PASSWORD),
        role,
        firstName: 'A',
        lastName: 'B',
        status: 'ACTIVE',
        tokenVersion,
        ...overrides,
        email,
        role,
      },
    });
    return { id, email, role, tokenVersion };
  }

  function signToken(user: { id: string; role: string; tokenVersion?: number }, extra: Record<string, unknown> = {}): Promise<string> {
    return jwtService.signAsync(
      {
        sub: user.id,
        role: user.role,
        typ: 'ADULT',
        gid: null,
        tid: null,
        tv: user.tokenVersion ?? 0,
        jti: randomUUID(),
        ...extra,
      },
      { expiresIn: '15m' },
    );
  }

  async function insertSuperAdmin(): Promise<{ userId: string; accessToken: string }> {
    const user = await insertUser({ role: 'SUPER_ADMIN' });
    const accessToken = await signToken(user, { role: 'SUPER_ADMIN' });
    return { userId: user.id, accessToken };
  }

  async function insertTrainer(): Promise<{ userId: string; trainerId: string }> {
    const user = await insertUser({ role: 'TRAINER' });
    const trainerId = randomUUID();
    await db.prisma.trainerProfile.create({ data: { id: trainerId, userId: user.id, businessName: 'Acme Co' } });
    return { userId: user.id, trainerId };
  }

  describe('POST /impersonation/start (Task 7.1)', () => {
    it('issues an impersonation token with the exact act-claim shape (arch §6.2) and no refresh cookie', async () => {
      const admin = await insertSuperAdmin();
      const target = await insertTrainer();

      const res = await request(app.getHttpServer())
        .post('/impersonation/start')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ targetUserId: target.userId });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        impersonationLogId: expect.any(String),
        expiresIn: 3600,
        target: { id: target.userId, role: 'TRAINER' },
      });

      const claims = await jwtService.decode(res.body.accessToken);
      expect(claims).toMatchObject({
        sub: target.userId,
        role: 'TRAINER',
        tid: target.trainerId,
        act: { sub: admin.userId, role: 'SUPER_ADMIN', imp: res.body.impersonationLogId },
      });

      // No refresh token issued (arch §10/ADR-03) — the admin's own session
      // (which never even logged in here) is untouched, and no Set-Cookie
      // header at all appears on this response.
      expect(res.headers['set-cookie']).toBeUndefined();

      const log = await db.prisma.impersonationLog.findUnique({ where: { id: res.body.impersonationLogId } });
      expect(log).toMatchObject({ adminUserId: admin.userId, targetUserId: target.userId, endedAt: null });
    });

    it('targeting a SUPER_ADMIN -> 422 IMPERSONATION_TARGET_INVALID', async () => {
      const admin = await insertSuperAdmin();
      const otherAdmin = await insertUser({ role: 'SUPER_ADMIN' });

      const res = await request(app.getHttpServer())
        .post('/impersonation/start')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ targetUserId: otherAdmin.id });

      expect(res.status).toBe(422);
      expect(res.body.errorCode).toBe('IMPERSONATION_TARGET_INVALID');
    });

    // "Already-impersonating caller -> 403 IMPERSONATION_NOT_ALLOWED"
    // (ImpersonationService.assertNotAlreadyImpersonating) is NOT reachable
    // via a real HTTP call to this route: `@Roles(SUPER_ADMIN)` guards it,
    // and — per `assertNotTargetingSuperAdmin` above plus RolesGuard's own
    // locked-in "always uses the effective role, never the impersonation
    // actor role" behavior (roles.guard.spec.ts) — an impersonation token's
    // effective role can never be SUPER_ADMIN, so RolesGuard always rejects
    // it first with a generic 403 FORBIDDEN before this service method ever
    // runs. The service-level check still exists and is exercised directly
    // in impersonation.service.spec.ts, as defense-in-depth (same rationale
    // arch §8 gives for its own multi-layer tenancy checks) — see that
    // file's own comment for the full explanation.

    it('unknown target -> 404', async () => {
      const admin = await insertSuperAdmin();

      const res = await request(app.getHttpServer())
        .post('/impersonation/start')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ targetUserId: randomUUID() });

      expect(res.status).toBe(404);
    });

    it('non-Super-Admin caller -> 403', async () => {
      const trainer = await insertTrainer();
      const trainerToken = await signToken({ id: trainer.userId, role: 'TRAINER' }, { role: 'TRAINER', tid: trainer.trainerId });
      const target = await insertTrainer();

      const res = await request(app.getHttpServer())
        .post('/impersonation/start')
        .set('Authorization', `Bearer ${trainerToken}`)
        .send({ targetUserId: target.userId });

      expect(res.status).toBe(403);
    });
  });

  describe('POST /impersonation/end (Task 7.2)', () => {
    it('stamps endedAt/durationSeconds and returns 204, called with the impersonation token itself', async () => {
      const admin = await insertSuperAdmin();
      const target = await insertTrainer();

      const startRes = await request(app.getHttpServer())
        .post('/impersonation/start')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ targetUserId: target.userId });
      expect(startRes.status).toBe(201);

      const impersonationToken = startRes.body.accessToken as string;
      const logId = startRes.body.impersonationLogId as string;

      const endRes = await request(app.getHttpServer())
        .post('/impersonation/end')
        .set('Authorization', `Bearer ${impersonationToken}`);

      expect(endRes.status).toBe(204);

      const log = await db.prisma.impersonationLog.findUnique({ where: { id: logId } });
      expect(log?.endedAt).not.toBeNull();
      expect(log?.durationSeconds).toEqual(expect.any(Number));
    });

    it('called with a non-impersonation token -> 403 IMPERSONATION_NOT_ALLOWED', async () => {
      const admin = await insertSuperAdmin();

      const res = await request(app.getHttpServer())
        .post('/impersonation/end')
        .set('Authorization', `Bearer ${admin.accessToken}`);

      expect(res.status).toBe(403);
      expect(res.body.errorCode).toBe('IMPERSONATION_NOT_ALLOWED');
    });
  });
});
