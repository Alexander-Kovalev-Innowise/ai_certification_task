import { randomUUID } from 'node:crypto';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import request from 'supertest';

import { resetTestDatabase, startTestDatabase, stopTestDatabase, TestDatabase } from './setup/testcontainers.setup';

// Task 5.1, first endpoint — extended in Task 5.2 (GET /player-profiles),
// Task 5.3 (GET /player-profiles/:id), Task 5.4 (PATCH /player-profiles/:id),
// Task 5.5 (GET /player-profiles/:id/trainers) and Task 5.14's RBAC/tenant/
// child-capability sweep, same convention coaches.e2e-spec.ts/
// share-links.e2e-spec.ts already established.
describe('PlayerProfilesController (e2e, Task 5.1)', () => {
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

  async function insertTrainer(overrides: Record<string, unknown> = {}): Promise<{ userId: string; trainerId: string; accessToken: string }> {
    const user = await insertUser({ role: 'TRAINER' });
    const trainerId = randomUUID();
    await db.prisma.trainerProfile.create({
      data: { id: trainerId, userId: user.id, businessName: 'Acme Co', ...overrides },
    });
    const accessToken = await signToken(user, { role: 'TRAINER', tid: trainerId });
    return { userId: user.id, trainerId, accessToken };
  }

  async function insertParent(): Promise<{ userId: string; accessToken: string }> {
    const user = await insertUser({ role: 'PLAYER_PARENT' });
    const accessToken = await signToken(user);
    return { userId: user.id, accessToken };
  }

  function validChildBody(overrides: Record<string, unknown> = {}) {
    return {
      name: 'Jamie Junior',
      dateOfBirth: '2015-06-01', // ~10 years old at test time
      gender: 'MALE',
      ...overrides,
    };
  }

  describe('POST /player-profiles (Task 5.1)', () => {
    it('creates a child profile -> 201', async () => {
      const parent = await insertParent();

      const res = await request(app.getHttpServer())
        .post('/player-profiles')
        .set('Authorization', `Bearer ${parent.accessToken}`)
        .send(validChildBody());

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ name: 'Jamie Junior', isSelf: false, accountUserId: parent.userId });

      const row = await db.prisma.playerProfile.findUnique({ where: { id: res.body.id } });
      expect(row).not.toBeNull();
    });

    it('age outside 1-18 -> 400 VALIDATION_ERROR', async () => {
      const parent = await insertParent();

      const res = await request(app.getHttpServer())
        .post('/player-profiles')
        .set('Authorization', `Bearer ${parent.accessToken}`)
        .send(validChildBody({ dateOfBirth: '2026-03-01' })); // < 1 year old

      expect(res.status).toBe(400);
      expect(res.body.errorCode).toBe('VALIDATION_ERROR');
    });

    it('a CHILD token -> 403 CHILD_CAPABILITY_DENIED', async () => {
      const parent = await insertParent();
      const childToken = await signToken({ id: parent.userId, role: 'PLAYER_PARENT' }, { typ: 'CHILD', gid: parent.userId });

      const res = await request(app.getHttpServer())
        .post('/player-profiles')
        .set('Authorization', `Bearer ${childToken}`)
        .send(validChildBody());

      expect(res.status).toBe(403);
      expect(res.body.errorCode).toBe('CHILD_CAPABILITY_DENIED');
    });

    it('providing trainerIds creates associations atomically with the profile', async () => {
      const parent = await insertParent();
      const trainer = await insertTrainer();

      const res = await request(app.getHttpServer())
        .post('/player-profiles')
        .set('Authorization', `Bearer ${parent.accessToken}`)
        .send(validChildBody({ trainerIds: [trainer.trainerId] }));

      expect(res.status).toBe(201);

      const association = await db.prisma.playerTrainerAssociation.findFirst({
        where: { playerProfileId: res.body.id, trainerId: trainer.trainerId },
      });
      expect(association).toMatchObject({ status: 'ACTIVE' });
    });

    it('duplicate name/age produces a warning field, not an error status', async () => {
      const parent = await insertParent();
      const body = validChildBody();

      const first = await request(app.getHttpServer())
        .post('/player-profiles')
        .set('Authorization', `Bearer ${parent.accessToken}`)
        .send(body);
      expect(first.status).toBe(201);
      expect(first.body.warning).toBeUndefined();

      const second = await request(app.getHttpServer())
        .post('/player-profiles')
        .set('Authorization', `Bearer ${parent.accessToken}`)
        .send(body);

      expect(second.status).toBe(200);
      expect(second.body.warning).toEqual(expect.any(String));

      const rows = await db.prisma.playerProfile.findMany({ where: { accountUserId: parent.userId } });
      expect(rows).toHaveLength(2);
    });
  });
});
