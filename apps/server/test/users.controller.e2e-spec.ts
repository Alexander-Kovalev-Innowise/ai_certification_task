import { randomUUID } from 'node:crypto';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import request from 'supertest';

import { resetTestDatabase, startTestDatabase, stopTestDatabase, TestDatabase } from './setup/testcontainers.setup';

// Task 2.22 — GET /me + PATCH /me. Testcontainers-backed, same env-var-
// before-import dance as auth.controller.e2e-spec.ts.
describe('UsersController (e2e, Task 2.22)', () => {
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

  async function login(email: string): Promise<string> {
    const res = await request(app.getHttpServer()).post('/auth/login').send({ email, password: KNOWN_PASSWORD });
    return res.body.accessToken as string;
  }

  function signChildToken(userId: string, guardianUserId: string): Promise<string> {
    return jwtService.signAsync(
      { sub: userId, role: 'PLAYER_PARENT', typ: 'CHILD', gid: guardianUserId, tid: null, tv: 0, jti: randomUUID() },
      { expiresIn: '15m' },
    );
  }

  it('GET /me never leaks passwordHash, even via a raw JSON diff', async () => {
    const { email } = await insertUser();
    const accessToken = await login(email);

    const res = await request(app.getHttpServer()).get('/me').set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ email, accountType: 'ADULT', emailVerified: false, mustChangePassword: false });
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash/i);
    expect(res.body.passwordHash).toBeUndefined();
  });

  it('PATCH /me updates common fields', async () => {
    const { email } = await insertUser();
    const accessToken = await login(email);

    const res = await request(app.getHttpServer())
      .patch('/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ firstName: 'Changed', photoUrl: 'https://example.com/photo.png' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ firstName: 'Changed', photoUrl: 'https://example.com/photo.png' });
  });

  it('PATCH /me as a CHILD login sending firstName -> 403 CHILD_FIELD_NOT_EDITABLE naming the field', async () => {
    const guardian = await insertUser();
    const child = await insertUser();
    const childToken = await signChildToken(child.id, guardian.id);

    const res = await request(app.getHttpServer())
      .patch('/me')
      .set('Authorization', `Bearer ${childToken}`)
      .send({ firstName: 'Nope' });

    expect(res.status).toBe(403);
    expect(res.body.errorCode).toBe('CHILD_FIELD_NOT_EDITABLE');
    expect(res.body.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'firstName' })]),
    );
  });

  it('PATCH /me as a CHILD login sending photoUrl/notificationPrefs succeeds', async () => {
    const guardian = await insertUser();
    const child = await insertUser();
    const childToken = await signChildToken(child.id, guardian.id);

    const res = await request(app.getHttpServer())
      .patch('/me')
      .set('Authorization', `Bearer ${childToken}`)
      .send({ photoUrl: 'https://example.com/child.png', notificationPrefs: { email: true } });

    expect(res.status).toBe(200);
    expect(res.body.photoUrl).toBe('https://example.com/child.png');
  });
});
