import { randomUUID } from 'node:crypto';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import request from 'supertest';

import { resetTestDatabase, startTestDatabase, stopTestDatabase, TestDatabase } from './setup/testcontainers.setup';

// Task 4.10. The full branch-matrix — auth state x `typ` x link type x
// expected branch — per the plan's own note that this is "the single
// highest-value test target per fe §10". Tasks 4.6-4.9's own
// test/share-links.e2e-spec.ts already proves each branch's side effects in
// depth (rows/outbox jobs/atomicity); this file is deliberately about
// dispatch correctness across the full cross-product, not re-proving those
// side effects.
//
// A SEPARATE file/app instance, not one more describe block appended to
// share-links.e2e-spec.ts: `POST /share-links/:code/redeem` carries
// `@Throttle({'auth-ip':{}})` (20 requests / 15 min / IP, arch §12) and that
// file's own Tasks 4.6-4.9 tests already make ~20 calls to this same route
// within one Jest run/one Nest app instance (one shared, in-memory
// ThrottlerStorage) — adding this matrix's own 9 calls on top tips it over
// into real `429 RATE_LIMITED` failures, discovered by running the combined
// file locally. A fresh `Test.createTestingModule(...).compile()` here gets
// its own ThrottlerStorage, exactly the same reasoning `auth.controller.e2e-spec.ts`
// and `users.e2e-spec.ts` already split across files for.
describe('ShareLinksController (e2e, Task 4.10) — full redeem branch matrix', () => {
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

  function signToken(user: { id: string; role: string }, extra: Record<string, unknown> = {}): Promise<string> {
    return jwtService.signAsync(
      { sub: user.id, role: user.role, typ: 'ADULT', gid: null, tid: null, tv: 0, jti: randomUUID(), ...extra },
      { expiresIn: '15m' },
    );
  }

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

  async function seedLink(type: 'PLAYER_STATIC' | 'COACH_UNIQUE', targetEmail?: string): Promise<{ code: string; trainerId: string }> {
    const trainer = await insertTrainer();
    const link = await db.prisma.shareLink.create({
      data: {
        code: `matrix-${randomUUID()}`,
        type,
        trainerId: trainer.trainerId,
        createdByUserId: trainer.userId,
        ...(type === 'COACH_UNIQUE' ? { targetEmail, expiresAt: new Date(Date.now() + 60_000) } : {}),
      },
    });
    return { code: link.code, trainerId: trainer.trainerId };
  }

  it('no auth + PLAYER_STATIC -> ANONYMOUS_REGISTRATION (201)', async () => {
    const link = await seedLink('PLAYER_STATIC');

    const res = await request(app.getHttpServer())
      .post(`/share-links/${link.code}/redeem`)
      .send({
        email: `${randomUUID()}@example.com`,
        password: 'Password1',
        phone: '+14155552671',
        playerName: 'Matrix Player',
        dateOfBirth: '2015-01-01',
        gender: 'OTHER',
        isSelf: false,
      });

    expect(res.status).toBe(201);
    expect(res.body.accessToken).toEqual(expect.any(String));
  });

  it('no auth + COACH_UNIQUE -> COACH_ACCEPT anonymous (201)', async () => {
    const targetEmail = `${randomUUID()}@example.com`;
    const link = await seedLink('COACH_UNIQUE', targetEmail);

    const res = await request(app.getHttpServer())
      .post(`/share-links/${link.code}/redeem`)
      .send({ password: 'Password1' });

    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ role: 'COACH' });
  });

  it('auth ADULT PLAYER_PARENT + PLAYER_STATIC -> ASSOCIATE_EXISTING (200)', async () => {
    const link = await seedLink('PLAYER_STATIC');
    const parent = await insertUser({ role: 'PLAYER_PARENT' });
    const profile = await db.prisma.playerProfile.create({
      data: { accountUserId: parent.id, name: 'Matrix Child', dateOfBirth: new Date('2016-01-01'), gender: 'OTHER', isSelf: false },
    });
    const accessToken = await signToken(parent, { role: 'PLAYER_PARENT' });

    const res = await request(app.getHttpServer())
      .post(`/share-links/${link.code}/redeem`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ subjectProfileIds: [profile.id] });

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('auth typ:CHILD + PLAYER_STATIC -> CHILD_SHARE_LINK_BLOCKED (403)', async () => {
    const link = await seedLink('PLAYER_STATIC');
    const guardian = await insertUser();
    const child = await insertUser();
    const childToken = await signToken(child, { typ: 'CHILD', gid: guardian.id });

    const res = await request(app.getHttpServer())
      .post(`/share-links/${link.code}/redeem`)
      .set('Authorization', `Bearer ${childToken}`)
      .send({});

    expect(res.status).toBe(403);
    expect(res.body.errorCode).toBe('CHILD_SHARE_LINK_BLOCKED');
  });

  it('auth typ:CHILD + COACH_UNIQUE -> CHILD_SHARE_LINK_BLOCKED (403) — link type does not change the CHILD branch', async () => {
    const link = await seedLink('COACH_UNIQUE', `${randomUUID()}@example.com`);
    const guardian = await insertUser();
    const child = await insertUser();
    const childToken = await signToken(child, { typ: 'CHILD', gid: guardian.id });

    const res = await request(app.getHttpServer())
      .post(`/share-links/${link.code}/redeem`)
      .set('Authorization', `Bearer ${childToken}`)
      .send({});

    expect(res.status).toBe(403);
    expect(res.body.errorCode).toBe('CHILD_SHARE_LINK_BLOCKED');
  });

  it('auth COACH + COACH_UNIQUE (own email) -> COACH_ACCEPT authenticated (200)', async () => {
    const coach = await insertUser({ role: 'COACH' });
    const link = await seedLink('COACH_UNIQUE', coach.email);
    const accessToken = await signToken(coach, { role: 'COACH' });

    const res = await request(app.getHttpServer())
      .post(`/share-links/${link.code}/redeem`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ trainerId: link.trainerId, status: 'ACTIVE' });
  });

  it.each(['PLAYER_STATIC', 'COACH_UNIQUE'] as const)(
    'auth TRAINER + %s -> 409 ROLE_CANNOT_REDEEM_SHARE_LINK',
    async (linkType) => {
      const link = await seedLink(linkType, linkType === 'COACH_UNIQUE' ? `${randomUUID()}@example.com` : undefined);
      const trainer = await insertUser({ role: 'TRAINER' });
      const accessToken = await signToken(trainer, { role: 'TRAINER' });

      const res = await request(app.getHttpServer())
        .post(`/share-links/${link.code}/redeem`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({});

      expect(res.status).toBe(409);
      expect(res.body.errorCode).toBe('ROLE_CANNOT_REDEEM_SHARE_LINK');
    },
  );

  it('auth SUPER_ADMIN + PLAYER_STATIC -> 409 ROLE_CANNOT_REDEEM_SHARE_LINK', async () => {
    const link = await seedLink('PLAYER_STATIC');
    const admin = await insertUser({ role: 'SUPER_ADMIN' });
    const accessToken = await signToken(admin, { role: 'SUPER_ADMIN' });

    const res = await request(app.getHttpServer())
      .post(`/share-links/${link.code}/redeem`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({});

    expect(res.status).toBe(409);
    expect(res.body.errorCode).toBe('ROLE_CANNOT_REDEEM_SHARE_LINK');
  });
});
