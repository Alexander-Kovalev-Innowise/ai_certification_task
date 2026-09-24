import { randomUUID } from 'node:crypto';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import request from 'supertest';

import { resetTestDatabase, startTestDatabase, stopTestDatabase, TestDatabase } from './setup/testcontainers.setup';

// Task 5.11 (api §4.5, player half), extended in Phase 6 (Tasks 6.1-6.3,
// coach "My Times" + conflict-check + override; Task 6.5's own describe
// block sweeps CRUD correctness, override logging and cross-tenant
// isolation across both), same e2e convention every other Phase 5/6 spec
// file already established.
describe('AvailabilityController (e2e, Task 5.11 + Phase 6)', () => {
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

  // Task 6.1. `trainerId` defaults to a freshly-seeded employing trainer
  // when not supplied — most coach tests only care about the coach's own
  // access, not the trainer relationship, but always need SOME valid
  // `TrainerProfile.id` for the required `CoachProfile.trainerId` column.
  async function insertCoach(overrides: { trainerId?: string } = {}): Promise<{ userId: string; coachId: string; trainerId: string; accessToken: string }> {
    const trainerId = overrides.trainerId ?? (await insertTrainer()).trainerId;
    const user = await insertUser({ role: 'COACH' });
    const coachId = randomUUID();
    await db.prisma.coachProfile.create({
      data: { id: coachId, userId: user.id, trainerId, status: 'ACTIVE' },
    });
    const accessToken = await signToken(user, { role: 'COACH', tid: trainerId });
    return { userId: user.id, coachId, trainerId, accessToken };
  }

  // Task 6.2. A `TRAINER` access token for a given `trainerId` — used by
  // the conflict-check/override tests below, which always act as "the
  // employing trainer" of a previously-seeded coach rather than a fresh
  // `insertTrainer()` (that would mint a NEW, unrelated tenant).
  async function trainerAccessToken(trainerId: string): Promise<string> {
    const trainer = await db.prisma.trainerProfile.findUniqueOrThrow({ where: { id: trainerId } });
    const trainerUser = await db.prisma.user.findUniqueOrThrow({ where: { id: trainer.userId } });
    return signToken({ id: trainerUser.id, role: 'TRAINER' }, { role: 'TRAINER', tid: trainerId });
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

  describe('PUT /coaches/:id/availability (Task 6.1)', () => {
    it('the coach themself can set their own availability -> 200, full replace', async () => {
      const coach = await insertCoach();
      await db.prisma.availability.create({
        data: { subjectType: 'COACH', coachProfileId: coach.coachId, dayOfWeek: 6, startTime: 60, endTime: 120, isAvailable: true },
      });

      const res = await request(app.getHttpServer())
        .put(`/coaches/${coach.coachId}/availability`)
        .set('Authorization', `Bearer ${coach.accessToken}`)
        .send({ slots: validSlots });

      expect(res.status).toBe(200);
      expect(res.body.coachProfileId).toBe(coach.coachId);
      expect(res.body.slots).toHaveLength(1);
      expect(res.body.slots[0]).toMatchObject(validSlots[0]);
    });

    it('the employing trainer cannot PUT (non-owner) -> 403', async () => {
      const coach = await insertCoach();
      const trainer = await db.prisma.trainerProfile.findUniqueOrThrow({ where: { id: coach.trainerId } });
      const trainerUser = await db.prisma.user.findUniqueOrThrow({ where: { id: trainer.userId } });
      const trainerToken = await signToken({ id: trainerUser.id, role: 'TRAINER' }, { role: 'TRAINER', tid: coach.trainerId });

      const res = await request(app.getHttpServer())
        .put(`/coaches/${coach.coachId}/availability`)
        .set('Authorization', `Bearer ${trainerToken}`)
        .send({ slots: validSlots });

      expect(res.status).toBe(403);
    });

    it('a coworker coach under the same trainer cannot PUT another coach -> 403', async () => {
      const coach = await insertCoach();
      const coworker = await insertCoach({ trainerId: coach.trainerId });

      const res = await request(app.getHttpServer())
        .put(`/coaches/${coach.coachId}/availability`)
        .set('Authorization', `Bearer ${coworker.accessToken}`)
        .send({ slots: validSlots });

      expect(res.status).toBe(403);
    });

    it('an unknown coachProfileId -> 404', async () => {
      const coach = await insertCoach();

      const res = await request(app.getHttpServer())
        .put(`/coaches/${randomUUID()}/availability`)
        .set('Authorization', `Bearer ${coach.accessToken}`)
        .send({ slots: validSlots });

      expect(res.status).toBe(404);
    });

    it('startTime >= endTime -> 400 VALIDATION_ERROR', async () => {
      const coach = await insertCoach();

      const res = await request(app.getHttpServer())
        .put(`/coaches/${coach.coachId}/availability`)
        .set('Authorization', `Bearer ${coach.accessToken}`)
        .send({ slots: [{ dayOfWeek: 1, startTime: 600, endTime: 600, isAvailable: true }] });

      expect(res.status).toBe(400);
      expect(res.body.errorCode).toBe('VALIDATION_ERROR');
    });
  });

  describe('GET /coaches/:id/availability (Task 6.1)', () => {
    it('the coach themself can read it -> 200', async () => {
      const coach = await insertCoach();
      await db.prisma.availability.create({
        data: { subjectType: 'COACH', coachProfileId: coach.coachId, ...validSlots[0] },
      });

      const res = await request(app.getHttpServer())
        .get(`/coaches/${coach.coachId}/availability`)
        .set('Authorization', `Bearer ${coach.accessToken}`);

      expect(res.status).toBe(200);
      expect(res.body.slots).toHaveLength(1);
    });

    it('the employing trainer can GET -> 200', async () => {
      const coach = await insertCoach();
      const trainer = await db.prisma.trainerProfile.findUniqueOrThrow({ where: { id: coach.trainerId } });
      const trainerUser = await db.prisma.user.findUniqueOrThrow({ where: { id: trainer.userId } });
      const trainerToken = await signToken({ id: trainerUser.id, role: 'TRAINER' }, { role: 'TRAINER', tid: coach.trainerId });

      const res = await request(app.getHttpServer())
        .get(`/coaches/${coach.coachId}/availability`)
        .set('Authorization', `Bearer ${trainerToken}`);

      expect(res.status).toBe(200);
    });

    it('an unknown coachProfileId -> 404', async () => {
      const coach = await insertCoach();

      const res = await request(app.getHttpServer())
        .get(`/coaches/${randomUUID()}/availability`)
        .set('Authorization', `Bearer ${coach.accessToken}`);

      expect(res.status).toBe(404);
    });
  });

  describe('GET /coaches/:id/availability/check (Task 6.2)', () => {
    it('a window only partially covered by an available slot -> hasConflict: true', async () => {
      const coach = await insertCoach();
      const trainerToken = await trainerAccessToken(coach.trainerId);
      await db.prisma.availability.create({
        data: { subjectType: 'COACH', coachProfileId: coach.coachId, dayOfWeek: 1, startTime: 9 * 60, endTime: 12 * 60, isAvailable: true },
      });

      const res = await request(app.getHttpServer())
        .get(`/coaches/${coach.coachId}/availability/check`)
        .query({ dayOfWeek: 1, startTime: 11 * 60, endTime: 13 * 60 })
        .set('Authorization', `Bearer ${trainerToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ hasConflict: true });
    });

    it('a window fully covered by an available slot -> hasConflict: false', async () => {
      const coach = await insertCoach();
      const trainerToken = await trainerAccessToken(coach.trainerId);
      await db.prisma.availability.create({
        data: { subjectType: 'COACH', coachProfileId: coach.coachId, dayOfWeek: 1, startTime: 9 * 60, endTime: 12 * 60, isAvailable: true },
      });

      const res = await request(app.getHttpServer())
        .get(`/coaches/${coach.coachId}/availability/check`)
        .query({ dayOfWeek: 1, startTime: 9 * 60 + 30, endTime: 11 * 60 })
        .set('Authorization', `Bearer ${trainerToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ hasConflict: false });
    });

    it('a non-owning trainer -> 403', async () => {
      const coach = await insertCoach();
      const stranger = await insertTrainer();

      const res = await request(app.getHttpServer())
        .get(`/coaches/${coach.coachId}/availability/check`)
        .query({ dayOfWeek: 1, startTime: 9 * 60, endTime: 10 * 60 })
        .set('Authorization', `Bearer ${stranger.accessToken}`);

      expect(res.status).toBe(403);
    });
  });

  describe('POST /coaches/:id/availability/override (Task 6.3)', () => {
    it('missing reason -> 400 VALIDATION_ERROR', async () => {
      const coach = await insertCoach();
      const trainerToken = await trainerAccessToken(coach.trainerId);

      const res = await request(app.getHttpServer())
        .post(`/coaches/${coach.coachId}/availability/override`)
        .set('Authorization', `Bearer ${trainerToken}`)
        .send({ eventId: randomUUID() });

      expect(res.status).toBe(400);
      expect(res.body.errorCode).toBe('VALIDATION_ERROR');
    });

    it('a non-owning trainer -> 403', async () => {
      const coach = await insertCoach();
      const stranger = await insertTrainer();

      const res = await request(app.getHttpServer())
        .post(`/coaches/${coach.coachId}/availability/override`)
        .set('Authorization', `Bearer ${stranger.accessToken}`)
        .send({ eventId: randomUUID(), reason: 'Only coach available for this slot' });

      expect(res.status).toBe(403);
    });

    it('success is always 201, never blocked by a conflict, and never touched by the coach -> 403', async () => {
      const coach = await insertCoach();
      const trainerToken = await trainerAccessToken(coach.trainerId);
      // The coach has explicitly marked themself UNAVAILABLE for this exact
      // window — BR-012 says the override endpoint never blocks anyway.
      await db.prisma.availability.create({
        data: { subjectType: 'COACH', coachProfileId: coach.coachId, dayOfWeek: 2, startTime: 9 * 60, endTime: 10 * 60, isAvailable: false },
      });

      const res = await request(app.getHttpServer())
        .post(`/coaches/${coach.coachId}/availability/override`)
        .set('Authorization', `Bearer ${trainerToken}`)
        .send({ eventId: randomUUID(), reason: 'Emergency substitution, coach agreed by phone' });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ coachId: coach.coachId, trainerId: coach.trainerId, reason: 'Emergency substitution, coach agreed by phone' });

      const coachRes = await request(app.getHttpServer())
        .post(`/coaches/${coach.coachId}/availability/override`)
        .set('Authorization', `Bearer ${coach.accessToken}`)
        .send({ eventId: randomUUID(), reason: 'Coach trying to log their own override' });

      expect(coachRes.status).toBe(403);
    });
  });
});
