import { randomUUID } from 'node:crypto';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
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

  async function insertUser(overrides: Record<string, unknown> = {}): Promise<{ id: string; email: string }> {
    const id = randomUUID();
    const email = (overrides.email as string | undefined) ?? `${id}@example.com`;
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
        email,
      },
    });
    return { id, email };
  }

  async function login(email: string): Promise<string> {
    const res = await request(app.getHttpServer()).post('/auth/login').send({ email, password: KNOWN_PASSWORD });
    return res.body.accessToken as string;
  }

  it('GET /users as a non-Super-Admin -> 403', async () => {
    const { email } = await insertUser();
    const accessToken = await login(email);

    const res = await request(app.getHttpServer()).get('/users').set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(403);
  });

  it('GET /users as Super Admin returns a keyset-paginated directory (never OFFSET), never leaking passwordHash', async () => {
    const { email: adminEmail } = await insertUser({ role: 'SUPER_ADMIN', firstName: 'Admin', lastName: 'Root' });
    const accessToken = await login(adminEmail);

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
    const { email: adminEmail } = await insertUser({ role: 'SUPER_ADMIN', firstName: 'Admin', lastName: 'Root' });
    const accessToken = await login(adminEmail);

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
    const { email } = await insertUser();
    const target = await insertUser();
    const accessToken = await login(email);

    const res = await request(app.getHttpServer())
      .get(`/users/${target.id}`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(403);
  });

  it('GET /users/:id unknown id -> 404', async () => {
    const { email: adminEmail } = await insertUser({ role: 'SUPER_ADMIN' });
    const accessToken = await login(adminEmail);

    const res = await request(app.getHttpServer())
      .get(`/users/${randomUUID()}`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(404);
  });

  it('GET /users/:id lets a Super Admin look up a soft-deleted user row', async () => {
    const { email: adminEmail } = await insertUser({ role: 'SUPER_ADMIN' });
    const accessToken = await login(adminEmail);

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
    const { email: adminEmail } = await insertUser({ role: 'SUPER_ADMIN' });
    const accessToken = await login(adminEmail);
    const target = await insertUser();

    const res = await request(app.getHttpServer())
      .patch(`/users/${target.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ firstName: 'Edited', lastName: 'ByAdmin' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: target.id, firstName: 'Edited', lastName: 'ByAdmin' });
  });

  it('PATCH /users/:id with a duplicate email -> 409 CONFLICT', async () => {
    const { email: adminEmail } = await insertUser({ role: 'SUPER_ADMIN' });
    const accessToken = await login(adminEmail);
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
    const { email: adminEmail } = await insertUser({ role: 'SUPER_ADMIN' });
    const accessToken = await login(adminEmail);
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
});
