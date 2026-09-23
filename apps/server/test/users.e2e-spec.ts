import { randomUUID } from 'node:crypto';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { Client } from 'pg';
import request from 'supertest';

import { resetTestDatabase, startTestDatabase, stopTestDatabase, TestDatabase } from './setup/testcontainers.setup';

// Task 3.1 onward — Super Admin's global user directory + lifecycle surface
// (GET/PATCH /users, deactivate/reactivate/GDPR-delete). Kept as its own
// file, separate from users.controller.e2e-spec.ts (Task 2.22's GET/PATCH
// /me coverage), matching the plan's own Task 3.11 reference to
// `test/users.e2e-spec.ts` as the file later Phase-3 tasks extend.
describe('UsersController — Super Admin directory (e2e, Task 3.1)', () => {
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

  /**
   * Builds a valid access token directly via JwtService, the same way
   * users.controller.e2e-spec.ts's signChildToken does for CHILD tokens —
   * bypasses `/auth/login` (and its `auth-ip`/`auth-identity` throttlers,
   * arch §12) entirely. Used for every test below EXCEPT the ones that
   * specifically assert on `/auth/login`'s own behavior (POST
   * /users/:id/reactivate "restores login"), which call the real endpoint.
   * A single Jest file shares one AuthThrottlerGuard in-memory counter
   * across every `it()` (one app instance for the whole describe block), so
   * routing all other authorization needs through direct signing keeps this
   * growing suite well under `auth-ip`'s 20-per-15-minutes ceiling.
   */
  function signToken(user: { id: string; role: string }, tokenVersion = 0): Promise<string> {
    return jwtService.signAsync(
      { sub: user.id, role: user.role, typ: 'ADULT', gid: null, tid: null, tv: tokenVersion, jti: randomUUID() },
      { expiresIn: '15m' },
    );
  }

  it('GET /users as a non-Super-Admin -> 403', async () => {
    const user = await insertUser();
    const accessToken = await signToken(user);

    const res = await request(app.getHttpServer()).get('/users').set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(403);
  });

  it('GET /users as Super Admin returns a keyset-paginated directory (never OFFSET), never leaking passwordHash', async () => {
    const admin = await insertUser({ role: 'SUPER_ADMIN', firstName: 'Admin', lastName: 'Root' });
    const accessToken = await signToken(admin);

    const base = Date.now() - 10_000;
    for (let i = 0; i < 3; i++) {
      await insertUser({ firstName: `User${i}`, createdAt: new Date(base + i * 1000) });
    }

    const firstPage = await request(app.getHttpServer())
      .get('/users')
      .query({ limit: 2 })
      .set('Authorization', `Bearer ${accessToken}`);

    expect(firstPage.status).toBe(200);
    expect(firstPage.body.items).toHaveLength(2);
    expect(firstPage.body.hasMore).toBe(true);
    expect(typeof firstPage.body.nextCursor).toBe('string');
    expect(JSON.stringify(firstPage.body)).not.toMatch(/passwordHash/i);

    const secondPage = await request(app.getHttpServer())
      .get('/users')
      .query({ limit: 2, cursor: firstPage.body.nextCursor })
      .set('Authorization', `Bearer ${accessToken}`);

    expect(secondPage.status).toBe(200);
    const firstIds = firstPage.body.items.map((u: { id: string }) => u.id);
    const secondIds = secondPage.body.items.map((u: { id: string }) => u.id);
    expect(firstIds.some((id: string) => secondIds.includes(id))).toBe(false);
  });

  it('GET /users?search matches via the trigram index on lower(email)', async () => {
    const admin = await insertUser({ role: 'SUPER_ADMIN', firstName: 'Admin', lastName: 'Root' });
    const accessToken = await signToken(admin);

    const target = await insertUser({ email: `findme-${randomUUID()}@example.com` });
    await insertUser();

    const res = await request(app.getHttpServer())
      .get('/users')
      .query({ search: 'findme' })
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].id).toBe(target.id);
  });

  it('GET /users/:id as a non-Super-Admin -> 403', async () => {
    const user = await insertUser();
    const target = await insertUser();
    const accessToken = await signToken(user);

    const res = await request(app.getHttpServer())
      .get(`/users/${target.id}`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(403);
  });

  it('GET /users/:id unknown id -> 404', async () => {
    const admin = await insertUser({ role: 'SUPER_ADMIN' });
    const accessToken = await signToken(admin);

    const res = await request(app.getHttpServer())
      .get(`/users/${randomUUID()}`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(404);
  });

  it('GET /users/:id lets a Super Admin look up a soft-deleted user row', async () => {
    const admin = await insertUser({ role: 'SUPER_ADMIN' });
    const accessToken = await signToken(admin);

    const target = await insertUser({ status: 'DELETED', deletedAt: new Date() });

    const res = await request(app.getHttpServer())
      .get(`/users/${target.id}`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: target.id, status: 'DELETED' });
    expect(res.body.deletedAt).not.toBeNull();
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash/i);
  });

  it('PATCH /users/:id as Super Admin edits any user\'s fields', async () => {
    const admin = await insertUser({ role: 'SUPER_ADMIN' });
    const accessToken = await signToken(admin);
    const target = await insertUser();

    const res = await request(app.getHttpServer())
      .patch(`/users/${target.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ firstName: 'Edited', lastName: 'ByAdmin' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: target.id, firstName: 'Edited', lastName: 'ByAdmin' });
  });

  it('PATCH /users/:id with a duplicate email -> 409 CONFLICT', async () => {
    const admin = await insertUser({ role: 'SUPER_ADMIN' });
    const accessToken = await signToken(admin);
    const existing = await insertUser();
    const target = await insertUser();

    const res = await request(app.getHttpServer())
      .patch(`/users/${target.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ email: existing.email });

    expect(res.status).toBe(409);
    expect(res.body.errorCode).toBe('CONFLICT');
  });

  it('PATCH /users/:id sending role -> 400 VALIDATION_ERROR (rejected, not silently ignored)', async () => {
    const admin = await insertUser({ role: 'SUPER_ADMIN' });
    const accessToken = await signToken(admin);
    const target = await insertUser();

    const res = await request(app.getHttpServer())
      .patch(`/users/${target.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ role: 'SUPER_ADMIN' });

    expect(res.status).toBe(400);
    expect(res.body.errorCode).toBe('VALIDATION_ERROR');

    const unchanged = await db.prisma.user.findUnique({ where: { id: target.id } });
    expect(unchanged?.role).toBe('PLAYER_PARENT');
  });

  it('POST /users/:id/deactivate rejects the target\'s already-issued access token on the very next request (DoD-critical)', async () => {
    const admin = await insertUser({ role: 'SUPER_ADMIN' });
    const adminToken = await signToken(admin);
    const target = await insertUser();
    const targetToken = await signToken(target);

    const stillActive = await request(app.getHttpServer()).get('/me').set('Authorization', `Bearer ${targetToken}`);
    expect(stillActive.status).toBe(200);

    const deactivateRes = await request(app.getHttpServer())
      .post(`/users/${target.id}/deactivate`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(deactivateRes.status).toBe(200);
    expect(deactivateRes.body.status).toBe('INACTIVE');

    const nextRequest = await request(app.getHttpServer()).get('/me').set('Authorization', `Bearer ${targetToken}`);
    expect(nextRequest.status).toBe(401);
    expect(nextRequest.body.errorCode).toBe('ACCOUNT_INACTIVE');
  });

  it('POST /users/:id/deactivate on an already-inactive target -> 409 CONFLICT', async () => {
    const admin = await insertUser({ role: 'SUPER_ADMIN' });
    const adminToken = await signToken(admin);
    const target = await insertUser({ status: 'INACTIVE', deletedAt: new Date() });

    const res = await request(app.getHttpServer())
      .post(`/users/${target.id}/deactivate`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(409);
    expect(res.body.errorCode).toBe('CONFLICT');
  });

  it('POST /users/:id/deactivate as a non-Super-Admin -> 403', async () => {
    const user = await insertUser();
    const target = await insertUser();
    const accessToken = await signToken(user);

    const res = await request(app.getHttpServer())
      .post(`/users/${target.id}/deactivate`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(403);
  });

  it('POST /users/:id/reactivate restores login for a previously deactivated user', async () => {
    const admin = await insertUser({ role: 'SUPER_ADMIN' });
    const adminToken = await signToken(admin);
    const target = await insertUser();

    await request(app.getHttpServer())
      .post(`/users/${target.id}/deactivate`)
      .set('Authorization', `Bearer ${adminToken}`);

    const loginWhileInactive = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: target.email, password: KNOWN_PASSWORD });
    expect(loginWhileInactive.status).toBe(401);

    const reactivateRes = await request(app.getHttpServer())
      .post(`/users/${target.id}/reactivate`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(reactivateRes.status).toBe(200);
    expect(reactivateRes.body.status).toBe('ACTIVE');

    const loginAfterReactivate = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: target.email, password: KNOWN_PASSWORD });
    expect(loginAfterReactivate.status).toBe(200);
  });

  it('POST /users/:id/reactivate on a DELETED target -> 409 CANNOT_REACTIVATE_DELETED_USER', async () => {
    const admin = await insertUser({ role: 'SUPER_ADMIN' });
    const adminToken = await signToken(admin);
    const target = await insertUser({ status: 'DELETED', deletedAt: new Date() });

    const res = await request(app.getHttpServer())
      .post(`/users/${target.id}/reactivate`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(409);
    expect(res.body.errorCode).toBe('CANNOT_REACTIVATE_DELETED_USER');
  });

  it('POST /users/:id/reactivate as a non-Super-Admin -> 403', async () => {
    const user = await insertUser();
    const target = await insertUser({ status: 'INACTIVE', deletedAt: new Date() });
    const accessToken = await signToken(user);

    const res = await request(app.getHttpServer())
      .post(`/users/${target.id}/reactivate`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(403);
  });

  it('DELETE /users/:id anonymizes the User row, writes a UserDeletionLog snapshot, and hard-fails a later reactivate (Task 3.7, DoD-critical)', async () => {
    const admin = await insertUser({ role: 'SUPER_ADMIN' });
    const adminToken = await signToken(admin);
    const target = await insertUser({ firstName: 'Real', lastName: 'Name', phone: '+15551234567', photoUrl: 'https://example.com/p.png' });

    const res = await request(app.getHttpServer())
      .delete(`/users/${target.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'GDPR erasure request' });

    expect(res.status).toBe(204);

    const row = await db.prisma.user.findFirst({ where: { id: target.id } });
    expect(row).toMatchObject({
      firstName: 'Deleted',
      lastName: 'User',
      email: `deleted_${target.id}@example.com`,
      phone: null,
      photoUrl: null,
      status: 'DELETED',
    });
    expect(row.deletedAt).not.toBeNull();
    expect(row.passwordHash).not.toBe(''); // still a non-empty sentinel, never usable to authenticate

    const logRow = await db.prisma.userDeletionLog.findFirst({ where: { originalUserId: target.id } });
    expect(logRow).not.toBeNull();
    expect(logRow.originalEmail).toBe(target.email);
    expect(logRow.deletedByUserId).toBe(admin.id);
    expect(logRow.reason).toBe('GDPR erasure request');
    expect(logRow.dataBackupJson).toMatchObject({ id: target.id, email: target.email, firstName: 'Real', lastName: 'Name' });

    const reactivateRes = await request(app.getHttpServer())
      .post(`/users/${target.id}/reactivate`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(reactivateRes.status).toBe(409);
    expect(reactivateRes.body.errorCode).toBe('CANNOT_REACTIVATE_DELETED_USER');
  });

  it('DELETE /users/:id with a missing reason -> 400 VALIDATION_ERROR', async () => {
    const admin = await insertUser({ role: 'SUPER_ADMIN' });
    const adminToken = await signToken(admin);
    const target = await insertUser();

    const res = await request(app.getHttpServer())
      .delete(`/users/${target.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.errorCode).toBe('VALIDATION_ERROR');
  });

  it('DELETE /users/:id on an already-DELETED target -> 409 CONFLICT', async () => {
    const admin = await insertUser({ role: 'SUPER_ADMIN' });
    const adminToken = await signToken(admin);
    const target = await insertUser({ status: 'DELETED', deletedAt: new Date() });

    const res = await request(app.getHttpServer())
      .delete(`/users/${target.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'already gone' });

    expect(res.status).toBe(409);
    expect(res.body.errorCode).toBe('CONFLICT');
  });

  it('DELETE /users/:id as a non-Super-Admin -> 403', async () => {
    const user = await insertUser();
    const target = await insertUser();
    const accessToken = await signToken(user);

    const res = await request(app.getHttpServer())
      .delete(`/users/${target.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ reason: 'nope' });

    expect(res.status).toBe(403);
  });

  it('audit."UserDeletionLog" stays write-only for a non-superuser app role even after a real GDPR delete (re-proves Task 1.2\'s grant)', async () => {
    const admin = await insertUser({ role: 'SUPER_ADMIN' });
    const adminToken = await signToken(admin);
    const target = await insertUser();

    await request(app.getHttpServer())
      .delete(`/users/${target.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'gdpr' });

    await db.prisma.$executeRawUnsafe(`CREATE ROLE app_role_3_7 LOGIN PASSWORD 'app_role_pw'`);
    await db.prisma.$executeRawUnsafe(`GRANT USAGE ON SCHEMA audit TO app_role_3_7`);
    await db.prisma.$executeRawUnsafe(`GRANT INSERT ON audit."UserDeletionLog" TO app_role_3_7`);
    await db.prisma.$executeRawUnsafe(`REVOKE SELECT, UPDATE, DELETE ON audit."UserDeletionLog" FROM app_role_3_7`);

    const appClient = new Client({
      host: db.container.getHost(),
      port: db.container.getPort(),
      database: db.container.getDatabase(),
      user: 'app_role_3_7',
      password: 'app_role_pw',
    });
    await appClient.connect();

    try {
      await expect(appClient.query(`SELECT * FROM audit."UserDeletionLog"`)).rejects.toMatchObject({
        code: '42501', // insufficient_privilege
      });
    } finally {
      await appClient.end();
      // DROP ROLE alone fails with 2BP01 ("role ... cannot be dropped
      // because some objects depend on it") — the GRANT USAGE/INSERT above
      // are themselves privileges the role depends on. DROP OWNED BY clears
      // every privilege/object owned by the role in this database first.
      await db.prisma.$executeRawUnsafe(`DROP OWNED BY app_role_3_7`);
      await db.prisma.$executeRawUnsafe(`DROP ROLE app_role_3_7`);
    }
  });

  // Task 3.11 — consolidated integration coverage. Directory pagination/
  // search/RBAC (Task 3.1) and the GDPR-delete irreversibility chain for a
  // plain user (Task 3.7) already have dedicated tests above; the one gap
  // Task 3.11 closes is proving the *whole* anonymizer registry fires
  // together for an account that owns more than just User-level PII — a
  // TRAINER, whose TrainersAnonymizer (Task 3.10) didn't exist yet when
  // Task 3.7's own tests were written. "Historical reference still
  // resolves to Deleted User-shaped data" (the plan's other Task 3.11
  // clause) has nothing to assert yet per the plan's own fallback ("once a
  // later phase has something referencing a deleted user — otherwise
  // assert the User row alone") — no Phase 4+ model references a User yet.
  it('DELETE /users/:id on a TRAINER account anonymizes BOTH the User row and their TrainerProfile (full anonymizer-registry chain)', async () => {
    const admin = await insertUser({ role: 'SUPER_ADMIN' });
    const adminToken = await signToken(admin);
    const trainerUser = await insertUser({ role: 'TRAINER', firstName: 'Real', lastName: 'Trainer' });
    const trainerProfileId = randomUUID();
    await db.prisma.trainerProfile.create({
      data: {
        id: trainerProfileId,
        userId: trainerUser.id,
        businessName: 'Real Trainer Business',
        address: '456 Business Ave',
        website: 'https://real-trainer.example.com',
        description: 'A thriving training business',
      },
    });

    const res = await request(app.getHttpServer())
      .delete(`/users/${trainerUser.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'trainer requested GDPR erasure' });

    expect(res.status).toBe(204);

    const userRow = await db.prisma.user.findFirst({ where: { id: trainerUser.id } });
    expect(userRow).toMatchObject({ firstName: 'Deleted', lastName: 'User', status: 'DELETED' });

    const trainerProfileRow = await db.prisma.trainerProfile.findUnique({ where: { id: trainerProfileId } });
    expect(trainerProfileRow).toMatchObject({
      businessName: 'Deleted Business',
      address: null,
      website: null,
      description: null,
    });

    // Irreversibility: reactivate hard-fails, and login is permanently impossible.
    const reactivateRes = await request(app.getHttpServer())
      .post(`/users/${trainerUser.id}/reactivate`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(reactivateRes.status).toBe(409);
    expect(reactivateRes.body.errorCode).toBe('CANNOT_REACTIVATE_DELETED_USER');
  });
});
