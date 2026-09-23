import { randomUUID } from 'node:crypto';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import request from 'supertest';

import { resetTestDatabase, startTestDatabase, stopTestDatabase, TestDatabase } from './setup/testcontainers.setup';

// Task 5.11 (api §4.5, player half — coach "My Times" is Phase 6), same
// e2e convention every other Phase 5 spec file already established.
describe('AvailabilityController — player availability (e2e, Task 5.11)', () => {
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

  async function insertProfile(accountUserId: string, overrides: Record<string, unknown> = {}) {
    return db.prisma.playerProfile.create({
      data: {
        accountUserId,
        name: 'Kid One',
        dateOfBirth: new Date('2016-01-01'),
        gender: 'FEMALE',
        isSelf: false,
        ...overrides,
      },
    });
  }

  const validSlots = [{ dayOfWeek: 1, startTime: 17 * 60, endTime: 20 * 60, isAvailable: true }];

  describe('PUT /player-profiles/:id/availability (Task 5.11)', () => {
    it('the owning adult can set availability -> 200, full replace', async () => {
      const parent = await insertParent();
      const profile = await insertProfile(parent.userId);
      await db.prisma.availability.create({
        data: { subjectType: 'PLAYER', playerProfileId: profile.id, dayOfWeek: 6, startTime: 60, endTime: 120, isAvailable: true },
      });

      const res = await request(app.getHttpServer())
        .put(`/player-profiles/${profile.id}/availability`)
        .set('Authorization', `Bearer ${parent.accessToken}`)
        .send({ slots: validSlots });

      expect(res.status).toBe(200);
      expect(res.body.slots).toHaveLength(1);
      expect(res.body.slots[0]).toMatchObject(validSlots[0]);

      const rows = await db.prisma.availability.findMany({ where: { playerProfileId: profile.id } });
      expect(rows).toHaveLength(1);
    });

    it('startTime >= endTime -> 400 VALIDATION_ERROR', async () => {
      const parent = await insertParent();
      const profile = await insertProfile(parent.userId);

      const res = await request(app.getHttpServer())
        .put(`/player-profiles/${profile.id}/availability`)
        .set('Authorization', `Bearer ${parent.accessToken}`)
        .send({ slots: [{ dayOfWeek: 1, startTime: 600, endTime: 600, isAvailable: true }] });

      expect(res.status).toBe(400);
      expect(res.body.errorCode).toBe('VALIDATION_ERROR');
    });

    it('startTime out of 0-1440 -> 400 VALIDATION_ERROR', async () => {
      const parent = await insertParent();
      const profile = await insertProfile(parent.userId);

      const res = await request(app.getHttpServer())
        .put(`/player-profiles/${profile.id}/availability`)
        .set('Authorization', `Bearer ${parent.accessToken}`)
        .send({ slots: [{ dayOfWeek: 1, startTime: -10, endTime: 600, isAvailable: true }] });

      expect(res.status).toBe(400);
      expect(res.body.errorCode).toBe('VALIDATION_ERROR');
    });

    it('a trainer with the player on their roster cannot PUT -> 404', async () => {
      const parent = await insertParent();
      const trainer = await insertTrainer();
      const profile = await insertProfile(parent.userId);
      await db.prisma.playerTrainerAssociation.create({ data: { trainerId: trainer.trainerId, playerProfileId: profile.id } });

      const res = await request(app.getHttpServer())
        .put(`/player-profiles/${profile.id}/availability`)
        .set('Authorization', `Bearer ${trainer.accessToken}`)
        .send({ slots: validSlots });

      expect(res.status).toBe(404);
    });

    it('a non-owning adult -> 404', async () => {
      const owner = await insertParent();
      const stranger = await insertParent();
      const profile = await insertProfile(owner.userId);

      const res = await request(app.getHttpServer())
        .put(`/player-profiles/${profile.id}/availability`)
        .set('Authorization', `Bearer ${stranger.accessToken}`)
        .send({ slots: validSlots });

      expect(res.status).toBe(404);
    });

    it('the child themself can set their own availability -> 200', async () => {
      const parent = await insertParent();
      const childUser = await insertUser({ role: 'PLAYER_PARENT' });
      const profile = await insertProfile(parent.userId, { childUserId: childUser.id });
      const childToken = await signToken(childUser, { typ: 'CHILD', gid: parent.userId });

      const res = await request(app.getHttpServer())
        .put(`/player-profiles/${profile.id}/availability`)
        .set('Authorization', `Bearer ${childToken}`)
        .send({ slots: validSlots });

      expect(res.status).toBe(200);
    });
  });

  describe('GET /player-profiles/:id/availability (Task 5.11)', () => {
    it('the owning adult can read it -> 200', async () => {
      const parent = await insertParent();
      const profile = await insertProfile(parent.userId);
      await db.prisma.availability.create({
        data: { subjectType: 'PLAYER', playerProfileId: profile.id, ...validSlots[0] },
      });

      const res = await request(app.getHttpServer())
        .get(`/player-profiles/${profile.id}/availability`)
        .set('Authorization', `Bearer ${parent.accessToken}`);

      expect(res.status).toBe(200);
      expect(res.body.slots).toHaveLength(1);
    });

    it('a trainer with the player on their roster can GET -> 200', async () => {
      const parent = await insertParent();
      const trainer = await insertTrainer();
      const profile = await insertProfile(parent.userId);
      await db.prisma.playerTrainerAssociation.create({ data: { trainerId: trainer.trainerId, playerProfileId: profile.id } });

      const res = await request(app.getHttpServer())
        .get(`/player-profiles/${profile.id}/availability`)
        .set('Authorization', `Bearer ${trainer.accessToken}`);

      expect(res.status).toBe(200);
    });

    it('a non-associated trainer -> 404', async () => {
      const parent = await insertParent();
      const trainer = await insertTrainer();
      const profile = await insertProfile(parent.userId);

      const res = await request(app.getHttpServer())
        .get(`/player-profiles/${profile.id}/availability`)
        .set('Authorization', `Bearer ${trainer.accessToken}`);

      expect(res.status).toBe(404);
    });
  });
});
