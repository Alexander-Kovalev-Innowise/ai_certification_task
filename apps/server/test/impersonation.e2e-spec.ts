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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- kept for Task 7.6's DI-wiring check (resolving ImpersonationMaintenanceJob for real)
  let moduleRef: any;

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

    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
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

  describe('GET /impersonation/history (Task 7.3)', () => {
    it('lists past sessions newest-first, each row shaped as {id, admin, target, startedAt, endedAt, durationSeconds}', async () => {
      const admin = await insertSuperAdmin();
      const targetA = await insertTrainer();
      const targetB = await insertTrainer();

      const startA = await request(app.getHttpServer())
        .post('/impersonation/start')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ targetUserId: targetA.userId });
      await request(app.getHttpServer())
        .post('/impersonation/end')
        .set('Authorization', `Bearer ${startA.body.accessToken}`);

      const startB = await request(app.getHttpServer())
        .post('/impersonation/start')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ targetUserId: targetB.userId });

      const res = await request(app.getHttpServer())
        .get('/impersonation/history')
        .set('Authorization', `Bearer ${admin.accessToken}`);

      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(2);
      // newest-first: targetB's still-open session was started after targetA's.
      expect(res.body.items[0]).toMatchObject({
        id: startB.body.impersonationLogId,
        admin: { id: admin.userId, role: 'SUPER_ADMIN' },
        target: { id: targetB.userId, role: 'TRAINER' },
        endedAt: null,
        durationSeconds: null,
      });
      expect(res.body.items[1]).toMatchObject({
        id: startA.body.impersonationLogId,
        target: { id: targetA.userId },
        durationSeconds: expect.any(Number),
      });
    });

    it('filters by targetUserId', async () => {
      const admin = await insertSuperAdmin();
      const targetA = await insertTrainer();
      const targetB = await insertTrainer();

      await request(app.getHttpServer())
        .post('/impersonation/start')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ targetUserId: targetA.userId });
      await request(app.getHttpServer())
        .post('/impersonation/start')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ targetUserId: targetB.userId });

      const res = await request(app.getHttpServer())
        .get('/impersonation/history')
        .query({ targetUserId: targetA.userId })
        .set('Authorization', `Bearer ${admin.accessToken}`);

      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0].target.id).toBe(targetA.userId);
    });

    it('paginates via nextCursor/hasMore (limit=1)', async () => {
      const admin = await insertSuperAdmin();
      const targetA = await insertTrainer();
      const targetB = await insertTrainer();

      await request(app.getHttpServer())
        .post('/impersonation/start')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ targetUserId: targetA.userId });
      await request(app.getHttpServer())
        .post('/impersonation/start')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ targetUserId: targetB.userId });

      const page1 = await request(app.getHttpServer())
        .get('/impersonation/history')
        .query({ limit: 1 })
        .set('Authorization', `Bearer ${admin.accessToken}`);

      expect(page1.body.items).toHaveLength(1);
      expect(page1.body.hasMore).toBe(true);
      expect(page1.body.nextCursor).toEqual(expect.any(String));

      const page2 = await request(app.getHttpServer())
        .get('/impersonation/history')
        .query({ limit: 1, cursor: page1.body.nextCursor })
        .set('Authorization', `Bearer ${admin.accessToken}`);

      expect(page2.body.items).toHaveLength(1);
      expect(page2.body.hasMore).toBe(false);
      expect(page2.body.items[0].target.id).not.toBe(page1.body.items[0].target.id);
    });

    it('non-Super-Admin caller -> 403', async () => {
      const trainer = await insertTrainer();
      const trainerToken = await signToken({ id: trainer.userId, role: 'TRAINER' }, { role: 'TRAINER', tid: trainer.trainerId });

      const res = await request(app.getHttpServer())
        .get('/impersonation/history')
        .set('Authorization', `Bearer ${trainerToken}`);

      expect(res.status).toBe(403);
    });
  });

  describe('Blast radius (Task 7.5)', () => {
    /**
     * All three routes ARE 403 with an impersonation token, matching the
     * plan's literal "→ 403" acceptance criteria — but the errorCode
     * observed here is `FORBIDDEN` (from `RolesGuard`), not
     * `IMPERSONATION_NOT_ALLOWED`: all three also carry `@Roles(SUPER_ADMIN)`,
     * and an impersonation token's effective role can never satisfy that
     * (`assertNotTargetingSuperAdmin`, Task 7.1, plus `RolesGuard`'s own
     * locked-in "always uses the effective role, never the impersonation
     * actor role", `roles.guard.spec.ts`) — so `RolesGuard` (pipeline step
     * 6) rejects the request before `CapabilitiesGuard`'s blast-radius check
     * (step 7, Task 7.5) is ever reached. The `IMPERSONATION_NOT_ALLOWED`
     * code IS genuinely produced by that check — proven directly against
     * `CapabilitiesGuard` in `capabilities.guard.spec.ts`, the level at
     * which it's actually reachable today (defense-in-depth for a future
     * capability/route that doesn't also carry a conflicting `@Roles`
     * gate). See that guard's own comment for the full explanation.
     */
    async function startImpersonation(): Promise<{ impersonationToken: string; adminToken: string }> {
      const admin = await insertSuperAdmin();
      const target = await insertTrainer();
      const res = await request(app.getHttpServer())
        .post('/impersonation/start')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ targetUserId: target.userId });
      return { impersonationToken: res.body.accessToken as string, adminToken: admin.accessToken };
    }

    it('POST /impersonation/start with an impersonation token -> 403', async () => {
      const { impersonationToken } = await startImpersonation();
      const anotherTarget = await insertTrainer();

      const res = await request(app.getHttpServer())
        .post('/impersonation/start')
        .set('Authorization', `Bearer ${impersonationToken}`)
        .send({ targetUserId: anotherTarget.userId });

      expect(res.status).toBe(403);
    });

    it('DELETE /users/:id with an impersonation token -> 403', async () => {
      const { impersonationToken } = await startImpersonation();
      const victim = await insertUser({ role: 'PLAYER_PARENT' });

      const res = await request(app.getHttpServer())
        .delete(`/users/${victim.id}`)
        .set('Authorization', `Bearer ${impersonationToken}`)
        .send({ reason: 'blast radius test' });

      expect(res.status).toBe(403);
    });

    it('POST /trainers with an impersonation token -> 403', async () => {
      const { impersonationToken } = await startImpersonation();

      const res = await request(app.getHttpServer())
        .post('/trainers')
        .set('Authorization', `Bearer ${impersonationToken}`)
        .send({
          businessName: 'Blast Radius Co',
          firstName: 'A',
          lastName: 'B',
          email: `${randomUUID()}@example.com`,
          phone: '+14155552671',
        });

      expect(res.status).toBe(403);
    });

    it('POST /impersonation/end still works with the blast-radius wiring live (the exemption)', async () => {
      const { impersonationToken } = await startImpersonation();

      const res = await request(app.getHttpServer())
        .post('/impersonation/end')
        .set('Authorization', `Bearer ${impersonationToken}`);

      expect(res.status).toBe(204);
    });
  });

  describe('Full round trip (Task 7.6)', () => {
    function extractCookie(setCookieHeader: string[], name: string): string {
      const raw = setCookieHeader.find((c) => c.startsWith(`${name}=`));
      if (!raw) throw new Error(`cookie ${name} not found in Set-Cookie header`);
      return raw.split(';')[0]!;
    }

    /**
     * The one place in this file that legitimately uses a real `/auth/login`
     * (per the plan's own pitfall note) — a signed test token has no
     * `RefreshToken` DB row or real cookie behind it, and this test's whole
     * point is proving the admin's ACTUAL refresh cookie survives an
     * impersonation session untouched.
     */
    it('start -> act as target -> end -> refresh -> back to admin, sub/role/tv unchanged', async () => {
      const adminId = randomUUID();
      const adminEmail = `${adminId}@example.com`;
      await db.prisma.user.create({
        data: {
          id: adminId,
          email: adminEmail,
          passwordHash: await argon2.hash(KNOWN_PASSWORD),
          role: 'SUPER_ADMIN',
          firstName: 'Admin',
          lastName: 'Root',
          status: 'ACTIVE',
        },
      });
      const target = await insertTrainer();

      // 1. Real login — the admin's actual refresh cookie/CSRF pair.
      const loginRes = await request(app.getHttpServer()).post('/auth/login').send({ email: adminEmail, password: KNOWN_PASSWORD });
      expect(loginRes.status).toBe(200);
      const adminAccessTokenBefore = loginRes.body.accessToken as string;
      const loginCookies = loginRes.headers['set-cookie'] as unknown as string[];
      const refreshCookie = extractCookie(loginCookies, 'refreshToken');
      const csrfCookie = extractCookie(loginCookies, 'csrf');
      const csrfToken = csrfCookie.split('=')[1];
      const claimsBefore = await jwtService.decode(adminAccessTokenBefore);

      // 2. Start impersonation.
      const startRes = await request(app.getHttpServer())
        .post('/impersonation/start')
        .set('Authorization', `Bearer ${adminAccessTokenBefore}`)
        .send({ targetUserId: target.userId });
      expect(startRes.status).toBe(201);
      const impersonationToken = startRes.body.accessToken as string;
      const logId = startRes.body.impersonationLogId as string;

      // 3. Do something AS the target — GET /me proves the effective
      // identity, PATCH /me is a genuine write made "during the session".
      // `AUDIT_STAMPED_MODELS` (audit-stamp.extension.ts, Task 1.7) is
      // deliberately empty for the whole of Epic-01 — no model yet carries
      // an `actorUserId`/`impersonationLogId` column pair to assert against
      // — so the concrete, persisted "both ids" audit record for Epic-01 is
      // the `ImpersonationLog` row itself (asserted below), and what THIS
      // step proves is the other half of SEC-003: the write actually lands
      // on the target's own row, under the target's own authorization,
      // never the admin's — the real guard pipeline (JwtAuthGuard ->
      // RolesGuard -> CapabilitiesGuard -> TenantContextInterceptor) acting
      // on a genuine impersonation-token request, not a hand-built
      // AuthContext like audit-stamp.extension.spec.ts's own unit tests.
      const meRes = await request(app.getHttpServer()).get('/me').set('Authorization', `Bearer ${impersonationToken}`);
      expect(meRes.status).toBe(200);
      expect(meRes.body.id).toBe(target.userId);
      expect(meRes.body.role).toBe('TRAINER');

      const patchRes = await request(app.getHttpServer())
        .patch('/me')
        .set('Authorization', `Bearer ${impersonationToken}`)
        .send({ firstName: 'Impersonated-Edit' });
      expect(patchRes.status).toBe(200);

      const targetRowAfterWrite = await db.prisma.user.findUniqueOrThrow({ where: { id: target.userId } });
      expect(targetRowAfterWrite.firstName).toBe('Impersonated-Edit');
      const adminRowUnaffected = await db.prisma.user.findUniqueOrThrow({ where: { id: adminId } });
      expect(adminRowUnaffected.firstName).toBe('Admin');

      // 4. End — discard the impersonation token client-side afterward.
      const endRes = await request(app.getHttpServer()).post('/impersonation/end').set('Authorization', `Bearer ${impersonationToken}`);
      expect(endRes.status).toBe(204);

      const log = await db.prisma.impersonationLog.findUniqueOrThrow({ where: { id: logId } });
      expect(log.adminUserId).toBe(adminId);
      expect(log.targetUserId).toBe(target.userId);
      expect(log.endedAt).not.toBeNull();
      expect(log.durationSeconds).toEqual(expect.any(Number));

      // 5. Refresh on the admin's ORIGINAL, never-touched refresh cookie —
      // zero re-login, sub/role/tv exactly what they were before.
      const refreshRes = await request(app.getHttpServer())
        .post('/auth/refresh')
        .set('Cookie', [refreshCookie, csrfCookie])
        .set('X-CSRF-Token', csrfToken);

      expect(refreshRes.status).toBe(200);
      const claimsAfter = await jwtService.decode(refreshRes.body.accessToken);
      expect(claimsAfter.sub).toBe(claimsBefore.sub);
      expect(claimsAfter.role).toBe(claimsBefore.role);
      expect(claimsAfter.tv).toBe(claimsBefore.tv);
      expect('act' in claimsAfter).toBe(false);
    });
  });

  describe('Stale-session cron, wired through the real app (Task 7.4 + 7.6)', () => {
    it('ImpersonationMaintenanceJob, resolved from the real DI container, closes a session past its 60-minute cap', async () => {
      const admin = await insertSuperAdmin();
      const target = await insertTrainer();

      const startRes = await request(app.getHttpServer())
        .post('/impersonation/start')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ targetUserId: target.userId });
      const logId = startRes.body.impersonationLogId as string;

      // Simulate a crashed client: never called /end, and the session
      // started well past the 60-minute cap.
      await db.prisma.impersonationLog.update({
        where: { id: logId },
        data: { startedAt: new Date(Date.now() - 90 * 60_000) },
      });

      /* eslint-disable @typescript-eslint/no-require-imports -- deliberate, matches this file's own beforeAll dance */
      const { ImpersonationMaintenanceJob } = require('../src/modules/impersonation/impersonation-maintenance.job') as typeof import('../src/modules/impersonation/impersonation-maintenance.job');
      /* eslint-enable @typescript-eslint/no-require-imports */
      const job = moduleRef.get(ImpersonationMaintenanceJob);
      await job.sweep();

      const log = await db.prisma.impersonationLog.findUniqueOrThrow({ where: { id: logId } });
      expect(log.endedAt).not.toBeNull();
      expect(log.durationSeconds).toBe(3600);
    });
  });
});
