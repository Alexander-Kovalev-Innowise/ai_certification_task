import { randomUUID } from 'node:crypto';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
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
  });

  afterAll(async () => {
    await app?.close();
    await stopTestDatabase(db);
    process.env.DATABASE_URL = originalDatabaseUrl;
  });

  afterEach(async () => {
    await resetTestDatabase(db);
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
});
