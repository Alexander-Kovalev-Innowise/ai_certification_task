import { createHash, randomUUID } from 'node:crypto';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import * as argon2 from 'argon2';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import request from 'supertest';

import { resetTestDatabase, startTestDatabase, stopTestDatabase, TestDatabase } from './setup/testcontainers.setup';

// Task 2.13 — started here, extended by every later auth task (2.14–2.20)
// per the plan's own convention rather than duplicated per endpoint.
// Testcontainers-backed (mirrors jwt-auth-guard.e2e-spec.ts's env-var-
// before-import dance): DATABASE_URL must point at the ephemeral container
// before shared/config/config.module.ts (imported transitively by
// AppModule) is first evaluated, so real login/rate-limit behavior never
// touches the shared dev database.
describe('AuthController (e2e, Task 2.13)', () => {
  jest.setTimeout(180_000);

  let db: TestDatabase;
  let app: INestApplication;
  let throttlerStorage: ThrottlerStorage;

  const originalDatabaseUrl = process.env.DATABASE_URL;
  const KNOWN_PASSWORD = 'CorrectHorseBattery1';

  beforeAll(async () => {
    db = await startTestDatabase();
    process.env.DATABASE_URL = db.connectionUri;

    /* eslint-disable @typescript-eslint/no-require-imports -- deliberate, defers evaluation until after DATABASE_URL is set */
    const { AppModule } = require('../src/app.module') as typeof import('../src/app.module');
    const { GlobalExceptionFilter } = require('../src/shared/http/global-exception.filter') as typeof import('../src/shared/http/global-exception.filter');
    /* eslint-enable @typescript-eslint/no-require-imports */

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(helmet());
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();

    throttlerStorage = moduleRef.get(ThrottlerStorage);
  });

  afterAll(async () => {
    await app?.close();
    await stopTestDatabase(db);
    process.env.DATABASE_URL = originalDatabaseUrl;
  });

  afterEach(async () => {
    await resetTestDatabase(db);
    // Every test in this file shares one app/IP; without clearing this,
    // `auth-ip`'s 20/15min ceiling (shared per route across the whole
    // file, not per test) trips on later, unrelated tests purely from
    // cumulative login calls. The rate-limit test itself explicitly checks
    // the real, un-cleared behavior before this runs.
    (throttlerStorage as unknown as { storage: Map<string, unknown> }).storage.clear();
  });

  function extractCookie(setCookieHeader: string[], name: string): string {
    const raw = setCookieHeader.find((c) => c.startsWith(`${name}=`));
    if (!raw) throw new Error(`cookie ${name} not found in Set-Cookie header`);
    return raw.split(';')[0]!.slice(name.length + 1);
  }

  async function loginAndGetCookies(email: string, password: string) {
    const res = await request(app.getHttpServer()).post('/auth/login').send({ email, password });
    const setCookieHeader = res.headers['set-cookie'] as unknown as string[];
    return {
      body: res.body,
      refreshToken: extractCookie(setCookieHeader, 'refreshToken'),
      csrf: extractCookie(setCookieHeader, 'csrf'),
    };
  }

  async function insertUser(overrides: Record<string, unknown> = {}): Promise<{ id: string; email: string }> {
    const id = randomUUID();
    const email = `${id}@example.com`;
    await db.prisma.user.create({
      data: {
        id,
        email,
        passwordHash: await argon2.hash(KNOWN_PASSWORD),
        role: 'PLAYER_PARENT',
        firstName: 'A',
        lastName: 'B',
        status: 'ACTIVE',
        ...overrides,
      },
    });
    return { id, email };
  }

  it('valid credentials -> 200, refreshToken + csrf cookies set, correct body shape', async () => {
    const { id, email } = await insertUser();

    const res = await request(app.getHttpServer()).post('/auth/login').send({ email, password: KNOWN_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      expiresIn: 900,
      user: { id, email, mustChangePassword: false },
    });
    expect(res.body.accessToken).toEqual(expect.any(String));

    const setCookieHeader = res.headers['set-cookie'] as unknown as string[];
    expect(setCookieHeader.some((c) => c.startsWith('refreshToken='))).toBe(true);
    expect(setCookieHeader.some((c) => c.startsWith('csrf='))).toBe(true);
    const refreshCookie = setCookieHeader.find((c) => c.startsWith('refreshToken='))!;
    expect(refreshCookie).toMatch(/HttpOnly/i);
    expect(refreshCookie).toMatch(/Secure/i);
    expect(refreshCookie).toMatch(/SameSite=Lax/i);
    expect(refreshCookie).toMatch(/Path=\/auth/i);
  });

  it('wrong password and unknown email produce byte-identical 401 bodies', async () => {
    const { email } = await insertUser();

    const wrongPassword = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: 'WrongPassword1' });
    const unknownEmail = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: `${randomUUID()}@nowhere.example`, password: 'WrongPassword1' });

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    // Byte-identical except `requestId`, which is unique per request by design.
    const { requestId: _a, ...wrongPasswordBody } = wrongPassword.body;
    const { requestId: _b, ...unknownEmailBody } = unknownEmail.body;
    expect(wrongPasswordBody).toEqual(unknownEmailBody);
    expect(wrongPassword.body.errorCode).toBe('UNAUTHORIZED');
  });

  it('inactive account -> 401 ACCOUNT_INACTIVE (distinct from wrong credentials)', async () => {
    const { email } = await insertUser({ status: 'INACTIVE' });

    const res = await request(app.getHttpServer()).post('/auth/login').send({ email, password: KNOWN_PASSWORD });

    expect(res.status).toBe(401);
    expect(res.body.errorCode).toBe('ACCOUNT_INACTIVE');
  });

  it('rejects malformed input with 400 VALIDATION_ERROR', async () => {
    const res = await request(app.getHttpServer()).post('/auth/login').send({ email: 'not-an-email', password: '' });

    expect(res.status).toBe(400);
    expect(res.body.errorCode).toBe('VALIDATION_ERROR');
  });

  it('rate-limits repeated attempts against the same identity with 429 + Retry-After', async () => {
    const email = `${randomUUID()}@example.com`;

    // auth-identity is the tighter of the two named limiters applied here (5/15min).
    for (let i = 0; i < 5; i += 1) {
       
      await request(app.getHttpServer()).post('/auth/login').send({ email, password: 'WrongPassword1' });
    }

    const res = await request(app.getHttpServer()).post('/auth/login').send({ email, password: 'WrongPassword1' });

    expect(res.status).toBe(429);
    const retryAfterHeader = Object.keys(res.headers).find((h) => h.toLowerCase().startsWith('retry-after'));
    expect(retryAfterHeader).toBeDefined();
  });

  describe('POST /auth/refresh (Task 2.14)', () => {
    it('valid refresh -> 200 with new rotated refreshToken + csrf cookies', async () => {
      const { email } = await insertUser();
      const { refreshToken, csrf } = await loginAndGetCookies(email, KNOWN_PASSWORD);

      const res = await request(app.getHttpServer())
        .post('/auth/refresh')
        .set('Cookie', [`refreshToken=${refreshToken}`, `csrf=${csrf}`])
        .set('X-CSRF-Token', csrf);

      expect(res.status).toBe(200);
      expect(res.body.accessToken).toEqual(expect.any(String));
      const setCookieHeader = res.headers['set-cookie'] as unknown as string[];
      const newRefreshToken = extractCookie(setCookieHeader, 'refreshToken');
      expect(newRefreshToken).not.toBe(refreshToken);
    });

    it('missing CSRF header -> 403 CSRF_MISMATCH', async () => {
      const { email } = await insertUser();
      const { refreshToken, csrf } = await loginAndGetCookies(email, KNOWN_PASSWORD);

      const res = await request(app.getHttpServer())
        .post('/auth/refresh')
        .set('Cookie', [`refreshToken=${refreshToken}`, `csrf=${csrf}`]);

      expect(res.status).toBe(403);
      expect(res.body.errorCode).toBe('CSRF_MISMATCH');
    });

    it('mismatched CSRF header -> 403 CSRF_MISMATCH', async () => {
      const { email } = await insertUser();
      const { refreshToken, csrf } = await loginAndGetCookies(email, KNOWN_PASSWORD);

      const res = await request(app.getHttpServer())
        .post('/auth/refresh')
        .set('Cookie', [`refreshToken=${refreshToken}`, `csrf=${csrf}`])
        .set('X-CSRF-Token', 'not-the-real-csrf-value');

      expect(res.status).toBe(403);
      expect(res.body.errorCode).toBe('CSRF_MISMATCH');
    });

    it('reusing an already-rotated (revoked) refresh token -> 401, and revokes the whole family (tokenVersion bumped)', async () => {
      const { id, email } = await insertUser();
      const { refreshToken, csrf } = await loginAndGetCookies(email, KNOWN_PASSWORD);

      // Ordinary rotation once — the original refreshToken is now revoked.
      await request(app.getHttpServer())
        .post('/auth/refresh')
        .set('Cookie', [`refreshToken=${refreshToken}`, `csrf=${csrf}`])
        .set('X-CSRF-Token', csrf);

      // Re-present the now-revoked original token (e.g. a stolen cookie replayed).
      const reuse = await request(app.getHttpServer())
        .post('/auth/refresh')
        .set('Cookie', [`refreshToken=${refreshToken}`, `csrf=${csrf}`])
        .set('X-CSRF-Token', csrf);

      expect(reuse.status).toBe(401);

      const user = await db.prisma.user.findUnique({ where: { id } });
      expect(user!.tokenVersion).toBeGreaterThan(0);
    });
  });

  describe('POST /auth/logout (Task 2.15)', () => {
    it('revokes the presented refresh token — a subsequent refresh with it fails', async () => {
      const { email } = await insertUser();
      const { body, refreshToken, csrf } = await loginAndGetCookies(email, KNOWN_PASSWORD);

      const logoutRes = await request(app.getHttpServer())
        .post('/auth/logout')
        .set('Authorization', `Bearer ${body.accessToken}`)
        .set('Cookie', [`refreshToken=${refreshToken}`, `csrf=${csrf}`])
        .set('X-CSRF-Token', csrf);
      expect(logoutRes.status).toBe(204);

      const refreshAfterLogout = await request(app.getHttpServer())
        .post('/auth/refresh')
        .set('Cookie', [`refreshToken=${refreshToken}`, `csrf=${csrf}`])
        .set('X-CSRF-Token', csrf);
      expect(refreshAfterLogout.status).toBe(401);
    });

    it('?everywhere=true revokes every session and bumps tokenVersion', async () => {
      const { id, email } = await insertUser();
      const session1 = await loginAndGetCookies(email, KNOWN_PASSWORD);
      const session2 = await loginAndGetCookies(email, KNOWN_PASSWORD);

      const logoutRes = await request(app.getHttpServer())
        .post('/auth/logout?everywhere=true')
        .set('Authorization', `Bearer ${session1.body.accessToken}`)
        .set('Cookie', [`refreshToken=${session1.refreshToken}`, `csrf=${session1.csrf}`])
        .set('X-CSRF-Token', session1.csrf);
      expect(logoutRes.status).toBe(204);

      const refreshSession1 = await request(app.getHttpServer())
        .post('/auth/refresh')
        .set('Cookie', [`refreshToken=${session1.refreshToken}`, `csrf=${session1.csrf}`])
        .set('X-CSRF-Token', session1.csrf);
      const refreshSession2 = await request(app.getHttpServer())
        .post('/auth/refresh')
        .set('Cookie', [`refreshToken=${session2.refreshToken}`, `csrf=${session2.csrf}`])
        .set('X-CSRF-Token', session2.csrf);

      expect(refreshSession1.status).toBe(401);
      expect(refreshSession2.status).toBe(401);

      const user = await db.prisma.user.findUnique({ where: { id } });
      expect(user!.tokenVersion).toBeGreaterThan(0);
    });

    it('requires the CSRF pair like refresh does', async () => {
      const { email } = await insertUser();
      const { body, refreshToken } = await loginAndGetCookies(email, KNOWN_PASSWORD);

      const res = await request(app.getHttpServer())
        .post('/auth/logout')
        .set('Authorization', `Bearer ${body.accessToken}`)
        .set('Cookie', [`refreshToken=${refreshToken}`]);

      expect(res.status).toBe(403);
      expect(res.body.errorCode).toBe('CSRF_MISMATCH');
    });
  });

  describe('POST /auth/forgot-password (Task 2.16)', () => {
    it('existing and non-existing email produce byte-identical 202 responses', async () => {
      const { email } = await insertUser();

      const existing = await request(app.getHttpServer()).post('/auth/forgot-password').send({ email });
      const nonExisting = await request(app.getHttpServer())
        .post('/auth/forgot-password')
        .send({ email: `${randomUUID()}@nowhere.example` });

      expect(existing.status).toBe(202);
      expect(nonExisting.status).toBe(202);
      expect(existing.body).toEqual(nonExisting.body);
      expect(existing.body).toEqual({ message: 'If that email exists, a reset link has been sent.' });
    });

    it('creates a PasswordResetToken row and a matching OutboxJob for an existing email', async () => {
      const { id, email } = await insertUser();

      await request(app.getHttpServer()).post('/auth/forgot-password').send({ email });

      const tokens = await db.prisma.passwordResetToken.findMany({ where: { userId: id } });
      expect(tokens).toHaveLength(1);
      expect(tokens[0]!.purpose).toBe('PASSWORD_RESET');

      const jobs = await db.prisma.outboxJob.findMany({ where: { type: 'EMAIL_PASSWORD_RESET' } });
      expect(jobs).toHaveLength(1);
    });

    it('creates neither row for a non-existing email', async () => {
      await request(app.getHttpServer())
        .post('/auth/forgot-password')
        .send({ email: `${randomUUID()}@nowhere.example` });

      const tokens = await db.prisma.passwordResetToken.findMany({});
      const jobs = await db.prisma.outboxJob.findMany({ where: { type: 'EMAIL_PASSWORD_RESET' } });
      expect(tokens).toHaveLength(0);
      expect(jobs).toHaveLength(0);
    });
  });

  describe('POST /auth/reset-password (Task 2.17)', () => {
    async function insertResetToken(userId: string, overrides: Record<string, unknown> = {}) {
      const rawToken = randomUUID();
      const tokenHash = createHash('sha256').update(rawToken).digest('hex');
      await db.prisma.passwordResetToken.create({
        data: {
          userId,
          token: tokenHash,
          purpose: 'PASSWORD_RESET',
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
          ...overrides,
        },
      });
      return rawToken;
    }

    it('valid token resets the password and revokes all sessions', async () => {
      const { id, email } = await insertUser();
      const { refreshToken, csrf } = await loginAndGetCookies(email, KNOWN_PASSWORD);
      const rawToken = await insertResetToken(id);

      const res = await request(app.getHttpServer())
        .post('/auth/reset-password')
        .send({ token: rawToken, newPassword: 'BrandNewPassword1' });
      expect(res.status).toBe(200);

      // Old session's refresh token is now revoked (tokenVersion bump / family revoke).
      const refreshAfter = await request(app.getHttpServer())
        .post('/auth/refresh')
        .set('Cookie', [`refreshToken=${refreshToken}`, `csrf=${csrf}`])
        .set('X-CSRF-Token', csrf);
      expect(refreshAfter.status).toBe(401);

      // New password works for login.
      const loginRes = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email, password: 'BrandNewPassword1' });
      expect(loginRes.status).toBe(200);
    });

    it('expired token -> 410 TOKEN_EXPIRED', async () => {
      const { id } = await insertUser();
      const rawToken = await insertResetToken(id, { expiresAt: new Date(Date.now() - 1000) });

      const res = await request(app.getHttpServer())
        .post('/auth/reset-password')
        .send({ token: rawToken, newPassword: 'BrandNewPassword1' });

      expect(res.status).toBe(410);
      expect(res.body.errorCode).toBe('TOKEN_EXPIRED');
    });

    it('already-used token -> 404 NOT_FOUND', async () => {
      const { id } = await insertUser();
      const rawToken = await insertResetToken(id, { usedAt: new Date() });

      const res = await request(app.getHttpServer())
        .post('/auth/reset-password')
        .send({ token: rawToken, newPassword: 'BrandNewPassword1' });

      expect(res.status).toBe(404);
      expect(res.body.errorCode).toBe('NOT_FOUND');
    });

    it('unknown token -> 404 NOT_FOUND', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/reset-password')
        .send({ token: 'does-not-exist', newPassword: 'BrandNewPassword1' });

      expect(res.status).toBe(404);
    });

    it('weak password -> 400 VALIDATION_ERROR', async () => {
      const { id } = await insertUser();
      const rawToken = await insertResetToken(id);

      const res = await request(app.getHttpServer())
        .post('/auth/reset-password')
        .send({ token: rawToken, newPassword: 'weak' });

      expect(res.status).toBe(400);
      expect(res.body.errorCode).toBe('VALIDATION_ERROR');
    });
  });

  describe('POST /auth/verify-email + /verify-email/resend (Task 2.18)', () => {
    async function insertVerificationToken(userId: string, overrides: Record<string, unknown> = {}) {
      const rawToken = randomUUID();
      const tokenHash = createHash('sha256').update(rawToken).digest('hex');
      await db.prisma.emailVerificationToken.create({
        data: {
          userId,
          token: tokenHash,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
          ...overrides,
        },
      });
      return rawToken;
    }

    it('valid token sets emailVerifiedAt', async () => {
      const { id } = await insertUser();
      const rawToken = await insertVerificationToken(id);

      const res = await request(app.getHttpServer()).post('/auth/verify-email').send({ token: rawToken });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ emailVerified: true });
      const user = await db.prisma.user.findUnique({ where: { id } });
      expect(user!.emailVerifiedAt).not.toBeNull();
    });

    it('expired token -> 410 TOKEN_EXPIRED', async () => {
      const { id } = await insertUser();
      const rawToken = await insertVerificationToken(id, { expiresAt: new Date(Date.now() - 1000) });

      const res = await request(app.getHttpServer()).post('/auth/verify-email').send({ token: rawToken });

      expect(res.status).toBe(410);
      expect(res.body.errorCode).toBe('TOKEN_EXPIRED');
    });

    it('invalid/unknown token -> 404 NOT_FOUND', async () => {
      const res = await request(app.getHttpServer()).post('/auth/verify-email').send({ token: 'nope' });

      expect(res.status).toBe(404);
      expect(res.body.errorCode).toBe('NOT_FOUND');
    });

    it('resend re-issues a fresh token, invalidating the previous one, and 409s once already verified', async () => {
      const { email } = await insertUser();
      const { body } = await loginAndGetCookies(email, KNOWN_PASSWORD);

      const first = await request(app.getHttpServer())
        .post('/auth/verify-email/resend')
        .set('Authorization', `Bearer ${body.accessToken}`);
      expect(first.status).toBe(202);

      const second = await request(app.getHttpServer())
        .post('/auth/verify-email/resend')
        .set('Authorization', `Bearer ${body.accessToken}`);
      expect(second.status).toBe(202);

      const tokens = await db.prisma.emailVerificationToken.findMany({ where: { userId: body.user.id } });
      expect(tokens).toHaveLength(2);
      expect(tokens.filter((t: { usedAt: Date | null }) => t.usedAt === null)).toHaveLength(1);

      // Now verify, then attempt resend again -> 409.
      await db.prisma.user.update({ where: { id: body.user.id }, data: { emailVerifiedAt: new Date() } });

      const thirdRes = await request(app.getHttpServer())
        .post('/auth/verify-email/resend')
        .set('Authorization', `Bearer ${body.accessToken}`);
      expect(thirdRes.status).toBe(409);
      expect(thirdRes.body.errorCode).toBe('CONFLICT');
    });
  });

  describe('POST /auth/change-password (Task 2.19)', () => {
    it('forced-first-change path succeeds without currentPassword when mustChangePassword is true', async () => {
      const { email } = await insertUser({ mustChangePassword: true });
      const { body } = await loginAndGetCookies(email, KNOWN_PASSWORD);
      expect(body.user.mustChangePassword).toBe(true);

      const res = await request(app.getHttpServer())
        .post('/auth/change-password')
        .set('Authorization', `Bearer ${body.accessToken}`)
        .send({ newPassword: 'BrandNewPassword1' });

      expect(res.status).toBe(200);

      const loginRes = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email, password: 'BrandNewPassword1' });
      expect(loginRes.status).toBe(200);
      expect(loginRes.body.user.mustChangePassword).toBe(false);
    });

    it('voluntary path requires currentPassword and validates it', async () => {
      const { email } = await insertUser();
      const { body } = await loginAndGetCookies(email, KNOWN_PASSWORD);

      const missingCurrent = await request(app.getHttpServer())
        .post('/auth/change-password')
        .set('Authorization', `Bearer ${body.accessToken}`)
        .send({ newPassword: 'BrandNewPassword1' });
      expect(missingCurrent.status).toBe(400);
      expect(missingCurrent.body.errorCode).toBe('VALIDATION_ERROR');

      const wrongCurrent = await request(app.getHttpServer())
        .post('/auth/change-password')
        .set('Authorization', `Bearer ${body.accessToken}`)
        .send({ currentPassword: 'NotTheRealOne1', newPassword: 'BrandNewPassword1' });
      expect(wrongCurrent.status).toBe(401);

      const correct = await request(app.getHttpServer())
        .post('/auth/change-password')
        .set('Authorization', `Bearer ${body.accessToken}`)
        .send({ currentPassword: KNOWN_PASSWORD, newPassword: 'BrandNewPassword1' });
      expect(correct.status).toBe(200);
    });

    it('bumps tokenVersion and revokes all refresh tokens (password-change-grade logout everywhere)', async () => {
      const { id, email } = await insertUser();
      const { body, refreshToken, csrf } = await loginAndGetCookies(email, KNOWN_PASSWORD);

      await request(app.getHttpServer())
        .post('/auth/change-password')
        .set('Authorization', `Bearer ${body.accessToken}`)
        .send({ currentPassword: KNOWN_PASSWORD, newPassword: 'BrandNewPassword1' });

      const refreshAfter = await request(app.getHttpServer())
        .post('/auth/refresh')
        .set('Cookie', [`refreshToken=${refreshToken}`, `csrf=${csrf}`])
        .set('X-CSRF-Token', csrf);
      expect(refreshAfter.status).toBe(401);

      const user = await db.prisma.user.findUnique({ where: { id } });
      expect(user!.tokenVersion).toBeGreaterThan(0);
    });
  });

  describe('POST /auth/register — trainer setup-link completion (Task 2.20)', () => {
    // Task 3.8 (Super-Admin provisions a trainer + sends a setup link)
    // doesn't exist yet — manually seed a User(role=TRAINER) with a
    // placeholder passwordHash and a PasswordResetToken(purpose:
    // 'TRAINER_SETUP'), per the plan's own note for this task.
    async function insertTrainerAwaitingSetup(overrides: Record<string, unknown> = {}) {
      const id = randomUUID();
      const email = `${id}@example.com`;
      await db.prisma.user.create({
        data: {
          id,
          email,
          passwordHash: 'placeholder-not-a-real-hash',
          role: 'TRAINER',
          firstName: 'Trainer',
          lastName: 'Setup',
          status: 'ACTIVE',
          mustChangePassword: true,
        },
      });
      const rawToken = randomUUID();
      const tokenHash = createHash('sha256').update(rawToken).digest('hex');
      await db.prisma.passwordResetToken.create({
        data: {
          userId: id,
          token: tokenHash,
          purpose: 'TRAINER_SETUP',
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
          ...overrides,
        },
      });
      return { id, email, rawToken };
    }

    it('valid setup token -> 200 + auto-login cookies, clears mustChangePassword', async () => {
      const { email, rawToken } = await insertTrainerAwaitingSetup();

      const res = await request(app.getHttpServer())
        .post('/auth/register')
        .send({ setupToken: rawToken, password: 'BrandNewPassword1' });

      expect(res.status).toBe(200);
      expect(res.body.accessToken).toEqual(expect.any(String));
      expect(res.body.user).toMatchObject({ email, mustChangePassword: false });
      const setCookieHeader = res.headers['set-cookie'] as unknown as string[];
      expect(setCookieHeader.some((c) => c.startsWith('refreshToken='))).toBe(true);
    });

    it('unknown token -> 404 NOT_FOUND', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/register')
        .send({ setupToken: 'nope', password: 'BrandNewPassword1' });

      expect(res.status).toBe(404);
      expect(res.body.errorCode).toBe('NOT_FOUND');
    });

    it('already-consumed token -> 409 CONFLICT', async () => {
      const { rawToken } = await insertTrainerAwaitingSetup({ usedAt: new Date() });

      const res = await request(app.getHttpServer())
        .post('/auth/register')
        .send({ setupToken: rawToken, password: 'BrandNewPassword1' });

      expect(res.status).toBe(409);
      expect(res.body.errorCode).toBe('CONFLICT');
    });

    it('expired token -> 410 TOKEN_EXPIRED', async () => {
      const { rawToken } = await insertTrainerAwaitingSetup({ expiresAt: new Date(Date.now() - 1000) });

      const res = await request(app.getHttpServer())
        .post('/auth/register')
        .send({ setupToken: rawToken, password: 'BrandNewPassword1' });

      expect(res.status).toBe(410);
      expect(res.body.errorCode).toBe('TOKEN_EXPIRED');
    });
  });

  // Task 2.23 — consolidates the remaining arch §20 DoD items touching auth
  // that weren't already asserted end-to-end by an earlier task's own tests:
  // a full login -> refresh -> logout round trip in one flow, and rate
  // limiting on /auth/forgot-password (its own dedicated identity/IP limiter,
  // distinct from /auth/login's — Task 2.16 tested forgot-password's
  // response shape but never its throttling). Rate limiting on /auth/login
  // itself and the JwtAuthGuard-specific DoD items (deactivation,
  // findUnique-vs-findFirst, pre-ALS ordering) are covered by this file's
  // own earlier "rate-limits repeated attempts..." test and by
  // jwt-auth-guard.e2e-spec.ts respectively — not duplicated here.
  describe('DoD integration sweep (Task 2.23)', () => {
    it('full session round trip: login -> refresh -> logout, each step building on the last', async () => {
      const { email } = await insertUser();

      const loginRes = await request(app.getHttpServer()).post('/auth/login').send({ email, password: KNOWN_PASSWORD });
      expect(loginRes.status).toBe(200);
      const loginCookies = loginRes.headers['set-cookie'] as unknown as string[];
      const refreshToken1 = extractCookie(loginCookies, 'refreshToken');
      const csrf1 = extractCookie(loginCookies, 'csrf');

      const refreshRes = await request(app.getHttpServer())
        .post('/auth/refresh')
        .set('Cookie', [`refreshToken=${refreshToken1}`, `csrf=${csrf1}`])
        .set('X-CSRF-Token', csrf1);
      expect(refreshRes.status).toBe(200);
      expect(refreshRes.body.accessToken).not.toBe(loginRes.body.accessToken);
      const refreshCookies = refreshRes.headers['set-cookie'] as unknown as string[];
      const refreshToken2 = extractCookie(refreshCookies, 'refreshToken');
      const csrf2 = extractCookie(refreshCookies, 'csrf');
      expect(refreshToken2).not.toBe(refreshToken1);

      const logoutRes = await request(app.getHttpServer())
        .post('/auth/logout')
        .set('Authorization', `Bearer ${refreshRes.body.accessToken}`)
        .set('Cookie', [`refreshToken=${refreshToken2}`, `csrf=${csrf2}`])
        .set('X-CSRF-Token', csrf2);
      expect(logoutRes.status).toBe(204);

      // The session is now fully wound down — the last-issued refresh token no longer works.
      const refreshAfterLogout = await request(app.getHttpServer())
        .post('/auth/refresh')
        .set('Cookie', [`refreshToken=${refreshToken2}`, `csrf=${csrf2}`])
        .set('X-CSRF-Token', csrf2);
      expect(refreshAfterLogout.status).toBe(401);
    });

    it('rate-limits repeated /auth/forgot-password attempts against the same identity with 429 + Retry-After', async () => {
      const email = `${randomUUID()}@example.com`;

      for (let i = 0; i < 5; i += 1) {
         
        await request(app.getHttpServer()).post('/auth/forgot-password').send({ email });
      }

      const res = await request(app.getHttpServer()).post('/auth/forgot-password').send({ email });

      expect(res.status).toBe(429);
      const retryAfterHeader = Object.keys(res.headers).find((h) => h.toLowerCase().startsWith('retry-after'));
      expect(retryAfterHeader).toBeDefined();
    });
  });
});
