import { randomUUID } from 'node:crypto';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import request from 'supertest';

import { seedTrainerPair } from './helpers/tenant-isolation.helper';
import { resetTestDatabase, startTestDatabase, stopTestDatabase, TestDatabase } from './setup/testcontainers.setup';

// Task 5.7, first endpoint (GET /me/contexts) — extended in Task 5.8
// (POST /player-profiles/:id/trainers), Task 5.9
// (DELETE /player-profiles/:id/trainers/:trainerId), Task 5.10
// (GET /trainers/:id/players) and Task 5.14's RBAC/tenant/child-capability
// sweep, same convention player-profiles.e2e-spec.ts/coaches.e2e-spec.ts
// already established.
describe('AssociationsController (e2e, Task 5.7)', () => {
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

  describe('GET /me/contexts (Task 5.7)', () => {
    it('an adult sees every active (profile, trainer) pair, grouped by profile', async () => {
      const parent = await insertParent();
      const trainer = await insertTrainer({ businessName: 'Elite FC' });
      const selfProfile = await insertProfile(parent.userId, { isSelf: true, name: 'Parent Self' });
      const childProfile = await insertProfile(parent.userId, { name: 'Kid One' });
      await db.prisma.playerTrainerAssociation.create({ data: { trainerId: trainer.trainerId, playerProfileId: selfProfile.id } });
      await db.prisma.playerTrainerAssociation.create({ data: { trainerId: trainer.trainerId, playerProfileId: childProfile.id } });

      const res = await request(app.getHttpServer())
        .get('/me/contexts')
        .set('Authorization', `Bearer ${parent.accessToken}`);

      expect(res.status).toBe(200);
      expect(res.body.contexts).toHaveLength(2);
      const selfEntry = res.body.contexts.find((c: { isSelf: boolean }) => c.isSelf);
      expect(selfEntry).toMatchObject({ playerProfileId: selfProfile.id, trainerId: trainer.trainerId, trainerDisplayName: 'Elite FC' });
    });

    it('an inactive association is excluded', async () => {
      const parent = await insertParent();
      const trainer = await insertTrainer();
      const profile = await insertProfile(parent.userId);
      await db.prisma.playerTrainerAssociation.create({
        data: { trainerId: trainer.trainerId, playerProfileId: profile.id, status: 'INACTIVE', disconnectedAt: new Date() },
      });

      const res = await request(app.getHttpServer())
        .get('/me/contexts')
        .set('Authorization', `Bearer ${parent.accessToken}`);

      expect(res.status).toBe(200);
      expect(res.body.contexts).toHaveLength(0);
    });

    it("a child context list never includes a 'Me' entry or sibling data", async () => {
      const parent = await insertParent();
      const trainer = await insertTrainer();
      const childUser = await insertUser({ role: 'PLAYER_PARENT' });
      const childProfile = await insertProfile(parent.userId, { childUserId: childUser.id, name: 'The Child' });
      const siblingProfile = await insertProfile(parent.userId, { name: 'Sibling' });
      const selfProfile = await insertProfile(parent.userId, { isSelf: true, name: 'Parent Self' });
      await db.prisma.playerTrainerAssociation.create({ data: { trainerId: trainer.trainerId, playerProfileId: childProfile.id } });
      await db.prisma.playerTrainerAssociation.create({ data: { trainerId: trainer.trainerId, playerProfileId: siblingProfile.id } });
      await db.prisma.playerTrainerAssociation.create({ data: { trainerId: trainer.trainerId, playerProfileId: selfProfile.id } });

      const childToken = await signToken(childUser, { typ: 'CHILD', gid: parent.userId });

      const res = await request(app.getHttpServer())
        .get('/me/contexts')
        .set('Authorization', `Bearer ${childToken}`);

      expect(res.status).toBe(200);
      expect(res.body.contexts).toHaveLength(1);
      expect(res.body.contexts[0].playerProfileId).toBe(childProfile.id);
      expect(res.body.contexts[0].isSelf).toBe(false);
    });
  });

  describe('POST /player-profiles/:id/trainers (Task 5.8)', () => {
    it('by trainerId -> 201, creates the association (parent already connected to that trainer)', async () => {
      const parent = await insertParent();
      const trainer = await insertTrainer();
      const profile = await insertProfile(parent.userId);
      const siblingProfile = await insertProfile(parent.userId, { name: 'Sibling' });
      await db.prisma.playerTrainerAssociation.create({ data: { trainerId: trainer.trainerId, playerProfileId: siblingProfile.id } });

      const res = await request(app.getHttpServer())
        .post(`/player-profiles/${profile.id}/trainers`)
        .set('Authorization', `Bearer ${parent.accessToken}`)
        .send({ trainerId: trainer.trainerId });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ trainerId: trainer.trainerId, playerProfileId: profile.id, status: 'ACTIVE' });
    });

    it('by shareLinkCode -> 201, resolves the trainer from the link', async () => {
      const parent = await insertParent();
      const trainer = await insertTrainer();
      const profile = await insertProfile(parent.userId);
      const link = await db.prisma.shareLink.create({
        data: { code: `code-${randomUUID()}`, type: 'PLAYER_STATIC', trainerId: trainer.trainerId, createdByUserId: trainer.userId },
      });

      const res = await request(app.getHttpServer())
        .post(`/player-profiles/${profile.id}/trainers`)
        .set('Authorization', `Bearer ${parent.accessToken}`)
        .send({ shareLinkCode: link.code });

      expect(res.status).toBe(201);
      expect(res.body.trainerId).toBe(trainer.trainerId);

      const after = await db.prisma.shareLink.findUniqueOrThrow({ where: { id: link.id } });
      expect(after.useCount).toBe(1);
    });

    it('by trainerId the parent is NOT connected to -> 404 and nothing is created (authorization)', async () => {
      const parent = await insertParent();
      const trainer = await insertTrainer();
      const profile = await insertProfile(parent.userId);

      const res = await request(app.getHttpServer())
        .post(`/player-profiles/${profile.id}/trainers`)
        .set('Authorization', `Bearer ${parent.accessToken}`)
        .send({ trainerId: trainer.trainerId });

      expect(res.status).toBe(404);
      expect(await db.prisma.playerTrainerAssociation.count({ where: { playerProfileId: profile.id } })).toBe(0);
    });

    it('by trainerId where the only association belongs to ANOTHER account -> 404', async () => {
      const parent = await insertParent();
      const stranger = await insertParent();
      const trainer = await insertTrainer();
      const profile = await insertProfile(parent.userId);
      const strangerProfile = await insertProfile(stranger.userId);
      await db.prisma.playerTrainerAssociation.create({ data: { trainerId: trainer.trainerId, playerProfileId: strangerProfile.id } });

      const res = await request(app.getHttpServer())
        .post(`/player-profiles/${profile.id}/trainers`)
        .set('Authorization', `Bearer ${parent.accessToken}`)
        .send({ trainerId: trainer.trainerId });

      expect(res.status).toBe(404);
    });

    it('neither field -> 400', async () => {
      const parent = await insertParent();
      const profile = await insertProfile(parent.userId);

      const res = await request(app.getHttpServer())
        .post(`/player-profiles/${profile.id}/trainers`)
        .set('Authorization', `Bearer ${parent.accessToken}`)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.errorCode).toBe('VALIDATION_ERROR');
    });

    it('both fields -> 400', async () => {
      const parent = await insertParent();
      const trainer = await insertTrainer();
      const profile = await insertProfile(parent.userId);

      const res = await request(app.getHttpServer())
        .post(`/player-profiles/${profile.id}/trainers`)
        .set('Authorization', `Bearer ${parent.accessToken}`)
        .send({ trainerId: trainer.trainerId, shareLinkCode: 'whatever' });

      expect(res.status).toBe(400);
      expect(res.body.errorCode).toBe('VALIDATION_ERROR');
    });

    it('unknown trainerId -> 404', async () => {
      const parent = await insertParent();
      const profile = await insertProfile(parent.userId);

      const res = await request(app.getHttpServer())
        .post(`/player-profiles/${profile.id}/trainers`)
        .set('Authorization', `Bearer ${parent.accessToken}`)
        .send({ trainerId: randomUUID() });

      expect(res.status).toBe(404);
    });

    it('unknown shareLinkCode -> 404', async () => {
      const parent = await insertParent();
      const profile = await insertProfile(parent.userId);

      const res = await request(app.getHttpServer())
        .post(`/player-profiles/${profile.id}/trainers`)
        .set('Authorization', `Bearer ${parent.accessToken}`)
        .send({ shareLinkCode: 'does-not-exist' });

      expect(res.status).toBe(404);
    });

    it('already-associated -> 200 with the existing row, not 409', async () => {
      const parent = await insertParent();
      const trainer = await insertTrainer();
      const profile = await insertProfile(parent.userId);
      await db.prisma.playerTrainerAssociation.create({ data: { trainerId: trainer.trainerId, playerProfileId: profile.id } });

      const res = await request(app.getHttpServer())
        .post(`/player-profiles/${profile.id}/trainers`)
        .set('Authorization', `Bearer ${parent.accessToken}`)
        .send({ trainerId: trainer.trainerId });

      expect(res.status).toBe(200);
      expect(res.body.alreadyConnected).toBe(true);

      const rows = await db.prisma.playerTrainerAssociation.findMany({ where: { trainerId: trainer.trainerId, playerProfileId: profile.id } });
      expect(rows).toHaveLength(1);
    });

    it('a CHILD token -> 403 CHILD_CAPABILITY_DENIED', async () => {
      const parent = await insertParent();
      const trainer = await insertTrainer();
      const childUser = await insertUser({ role: 'PLAYER_PARENT' });
      const profile = await insertProfile(parent.userId, { childUserId: childUser.id });
      const childToken = await signToken(childUser, { typ: 'CHILD', gid: parent.userId });

      const res = await request(app.getHttpServer())
        .post(`/player-profiles/${profile.id}/trainers`)
        .set('Authorization', `Bearer ${childToken}`)
        .send({ trainerId: trainer.trainerId });

      expect(res.status).toBe(403);
      expect(res.body.errorCode).toBe('CHILD_CAPABILITY_DENIED');
    });
  });

  describe('DELETE /player-profiles/:id/trainers/:trainerId (Task 5.9)', () => {
    it('marks the association INACTIVE -> 204', async () => {
      const parent = await insertParent();
      const trainer = await insertTrainer();
      const profile = await insertProfile(parent.userId);
      const association = await db.prisma.playerTrainerAssociation.create({
        data: { trainerId: trainer.trainerId, playerProfileId: profile.id },
      });

      const res = await request(app.getHttpServer())
        .delete(`/player-profiles/${profile.id}/trainers/${trainer.trainerId}`)
        .set('Authorization', `Bearer ${parent.accessToken}`);

      expect(res.status).toBe(204);

      const row = await db.prisma.playerTrainerAssociation.findUnique({ where: { id: association.id } });
      expect(row).toMatchObject({ status: 'INACTIVE' });
      expect(row?.disconnectedAt).not.toBeNull();
    });

    it('unknown association -> 404', async () => {
      const parent = await insertParent();
      const trainer = await insertTrainer();
      const profile = await insertProfile(parent.userId);

      const res = await request(app.getHttpServer())
        .delete(`/player-profiles/${profile.id}/trainers/${trainer.trainerId}`)
        .set('Authorization', `Bearer ${parent.accessToken}`);

      expect(res.status).toBe(404);
    });

    it('a CHILD token -> 403 CHILD_CAPABILITY_DENIED', async () => {
      const parent = await insertParent();
      const trainer = await insertTrainer();
      const childUser = await insertUser({ role: 'PLAYER_PARENT' });
      const profile = await insertProfile(parent.userId, { childUserId: childUser.id });
      await db.prisma.playerTrainerAssociation.create({ data: { trainerId: trainer.trainerId, playerProfileId: profile.id } });
      const childToken = await signToken(childUser, { typ: 'CHILD', gid: parent.userId });

      const res = await request(app.getHttpServer())
        .delete(`/player-profiles/${profile.id}/trainers/${trainer.trainerId}`)
        .set('Authorization', `Bearer ${childToken}`);

      expect(res.status).toBe(403);
      expect(res.body.errorCode).toBe('CHILD_CAPABILITY_DENIED');
    });
  });

  describe('GET /trainers/:id/players (Task 5.10)', () => {
    it('returns the roster with a formatted availabilitySummary', async () => {
      const parent = await insertParent();
      const trainer = await insertTrainer();
      const profile = await insertProfile(parent.userId, { name: 'Roster Kid', dateOfBirth: new Date('2016-01-01') });
      await db.prisma.playerTrainerAssociation.create({ data: { trainerId: trainer.trainerId, playerProfileId: profile.id } });
      await db.prisma.availability.create({
        data: { subjectType: 'PLAYER', playerProfileId: profile.id, dayOfWeek: 1, startTime: 17 * 60, endTime: 20 * 60, isAvailable: true },
      });
      await db.prisma.availability.create({
        data: { subjectType: 'PLAYER', playerProfileId: profile.id, dayOfWeek: 3, startTime: 18 * 60, endTime: 21 * 60, isAvailable: true },
      });

      const res = await request(app.getHttpServer())
        .get(`/trainers/${trainer.trainerId}/players`)
        .set('Authorization', `Bearer ${trainer.accessToken}`);

      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0]).toMatchObject({
        playerProfileId: profile.id,
        name: 'Roster Kid',
        availabilitySummary: 'Best Times: Mon 5-8pm, Wed 6-9pm',
      });
      expect(typeof res.body.items[0].age).toBe('number');
    });

    it('a day/time filter narrows results to matching players only', async () => {
      const parent = await insertParent();
      const trainer = await insertTrainer();
      const availableMonday = await insertProfile(parent.userId, { name: 'Available Monday' });
      const availableTuesday = await insertProfile(parent.userId, { name: 'Available Tuesday' });
      await db.prisma.playerTrainerAssociation.create({ data: { trainerId: trainer.trainerId, playerProfileId: availableMonday.id } });
      await db.prisma.playerTrainerAssociation.create({ data: { trainerId: trainer.trainerId, playerProfileId: availableTuesday.id } });
      await db.prisma.availability.create({
        data: { subjectType: 'PLAYER', playerProfileId: availableMonday.id, dayOfWeek: 1, startTime: 17 * 60, endTime: 20 * 60, isAvailable: true },
      });
      await db.prisma.availability.create({
        data: { subjectType: 'PLAYER', playerProfileId: availableTuesday.id, dayOfWeek: 2, startTime: 17 * 60, endTime: 20 * 60, isAvailable: true },
      });

      const res = await request(app.getHttpServer())
        .get(`/trainers/${trainer.trainerId}/players`)
        .query({ dayOfWeek: 1 })
        .set('Authorization', `Bearer ${trainer.accessToken}`);

      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0].playerProfileId).toBe(availableMonday.id);
    });

    it('cross-tenant -> 404 (never 403, arch §8 Layer 3)', async () => {
      const trainerA = await insertTrainer();
      const trainerB = await insertTrainer();

      const res = await request(app.getHttpServer())
        .get(`/trainers/${trainerA.trainerId}/players`)
        .set('Authorization', `Bearer ${trainerB.accessToken}`);

      expect(res.status).toBe(404);
      expect(res.body.errorCode).toBe('NOT_FOUND');
    });

    it('a removed association immediately excludes the player from the roster', async () => {
      const parent = await insertParent();
      const trainer = await insertTrainer();
      const profile = await insertProfile(parent.userId);
      await db.prisma.playerTrainerAssociation.create({ data: { trainerId: trainer.trainerId, playerProfileId: profile.id } });

      const before = await request(app.getHttpServer())
        .get(`/trainers/${trainer.trainerId}/players`)
        .set('Authorization', `Bearer ${trainer.accessToken}`);
      expect(before.body.items).toHaveLength(1);

      await request(app.getHttpServer())
        .delete(`/player-profiles/${profile.id}/trainers/${trainer.trainerId}`)
        .set('Authorization', `Bearer ${parent.accessToken}`)
        .expect(204);

      const after = await request(app.getHttpServer())
        .get(`/trainers/${trainer.trainerId}/players`)
        .set('Authorization', `Bearer ${trainer.accessToken}`);
      expect(after.body.items).toHaveLength(0);
    });

    it('returns availableCount/totalCount for the active day/time filter (US-01.09)', async () => {
      const parent = await insertParent();
      const trainer = await insertTrainer();
      const names = ['A', 'B', 'C'];
      const profiles = [];
      for (const name of names) {
        const profile = await insertProfile(parent.userId, { name });
        await db.prisma.playerTrainerAssociation.create({ data: { trainerId: trainer.trainerId, playerProfileId: profile.id } });
        profiles.push(profile);
      }
      // A: Mon 17-20 available; B: Mon 17-20 but explicitly unavailable; C: Tue only.
      await db.prisma.availability.create({
        data: { subjectType: 'PLAYER', playerProfileId: profiles[0].id, dayOfWeek: 1, startTime: 17 * 60, endTime: 20 * 60, isAvailable: true },
      });
      await db.prisma.availability.create({
        data: { subjectType: 'PLAYER', playerProfileId: profiles[1].id, dayOfWeek: 1, startTime: 17 * 60, endTime: 20 * 60, isAvailable: false },
      });
      await db.prisma.availability.create({
        data: { subjectType: 'PLAYER', playerProfileId: profiles[2].id, dayOfWeek: 2, startTime: 17 * 60, endTime: 20 * 60, isAvailable: true },
      });

      const unfiltered = await request(app.getHttpServer())
        .get(`/trainers/${trainer.trainerId}/players`)
        .set('Authorization', `Bearer ${trainer.accessToken}`);
      expect(unfiltered.body).toMatchObject({ totalCount: 3, availableCount: 3 });

      const filtered = await request(app.getHttpServer())
        .get(`/trainers/${trainer.trainerId}/players`)
        .query({ dayOfWeek: 1, startTime: 18 * 60, endTime: 19 * 60 })
        .set('Authorization', `Bearer ${trainer.accessToken}`);
      expect(filtered.body).toMatchObject({ totalCount: 3, availableCount: 1 });
      expect(filtered.body.items).toHaveLength(1);
      expect(filtered.body.items[0].playerProfileId).toBe(profiles[0].id);

      const outsideWindow = await request(app.getHttpServer())
        .get(`/trainers/${trainer.trainerId}/players`)
        .query({ dayOfWeek: 1, startTime: 8 * 60, endTime: 9 * 60 })
        .set('Authorization', `Bearer ${trainer.accessToken}`);
      expect(outsideWindow.body).toMatchObject({ totalCount: 3, availableCount: 0, items: [] });
    });

    it('paginates in the database with a real keyset cursor (counts span all pages)', async () => {
      const parent = await insertParent();
      const trainer = await insertTrainer();
      for (let i = 0; i < 5; i += 1) {
        const profile = await insertProfile(parent.userId, { name: `Kid ${i}` });
        await db.prisma.playerTrainerAssociation.create({
          data: { trainerId: trainer.trainerId, playerProfileId: profile.id, connectedAt: new Date(Date.now() - i * 1000) },
        });
        await db.prisma.availability.create({
          data: { subjectType: 'PLAYER', playerProfileId: profile.id, dayOfWeek: 4, startTime: 600, endTime: 900, isAvailable: true },
        });
      }

      const seen: string[] = [];
      let cursor: string | null = null;
      let pages = 0;
      do {
        const res: request.Response = await request(app.getHttpServer())
          .get(`/trainers/${trainer.trainerId}/players`)
          .query({ limit: 2, dayOfWeek: 4, ...(cursor ? { cursor } : {}) })
          .set('Authorization', `Bearer ${trainer.accessToken}`);
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ totalCount: 5, availableCount: 5 });
        seen.push(...res.body.items.map((r: { playerProfileId: string }) => r.playerProfileId));
        cursor = res.body.nextCursor;
        expect(res.body.hasMore).toBe(cursor !== null);
        pages += 1;
      } while (cursor && pages < 10);

      expect(pages).toBe(3);
      expect(new Set(seen).size).toBe(5);
    });

    it('a malformed cursor -> 400 VALIDATION_ERROR', async () => {
      const trainer = await insertTrainer();
      const res = await request(app.getHttpServer())
        .get(`/trainers/${trainer.trainerId}/players`)
        .query({ cursor: 'garbage' })
        .set('Authorization', `Bearer ${trainer.accessToken}`);
      expect(res.status).toBe(400);
      expect(res.body.errorCode).toBe('VALIDATION_ERROR');
    });
  });

  describe('DELETE /trainers/:id/players/:playerProfileId (trainer removes a player)', () => {
    it('soft-removes the association (INACTIVE + disconnectedAt, row kept) and the roster refreshes', async () => {
      const parent = await insertParent();
      const trainer = await insertTrainer();
      const profile = await insertProfile(parent.userId);
      const assoc = await db.prisma.playerTrainerAssociation.create({ data: { trainerId: trainer.trainerId, playerProfileId: profile.id } });

      await request(app.getHttpServer())
        .delete(`/trainers/${trainer.trainerId}/players/${profile.id}`)
        .set('Authorization', `Bearer ${trainer.accessToken}`)
        .expect(204);

      const row = await db.prisma.playerTrainerAssociation.findUnique({ where: { id: assoc.id } });
      expect(row?.status).toBe('INACTIVE');
      expect(row?.disconnectedAt).not.toBeNull();

      const roster = await request(app.getHttpServer())
        .get(`/trainers/${trainer.trainerId}/players`)
        .set('Authorization', `Bearer ${trainer.accessToken}`);
      expect(roster.body.items).toHaveLength(0);
      expect(roster.body.totalCount).toBe(0);

      // Already removed -> 404.
      await request(app.getHttpServer())
        .delete(`/trainers/${trainer.trainerId}/players/${profile.id}`)
        .set('Authorization', `Bearer ${trainer.accessToken}`)
        .expect(404);
    });

    it("another trainer's roster -> 404 (never 403) and nothing changes", async () => {
      const parent = await insertParent();
      const trainerA = await insertTrainer();
      const trainerB = await insertTrainer();
      const profile = await insertProfile(parent.userId);
      await db.prisma.playerTrainerAssociation.create({ data: { trainerId: trainerA.trainerId, playerProfileId: profile.id } });

      const res = await request(app.getHttpServer())
        .delete(`/trainers/${trainerA.trainerId}/players/${profile.id}`)
        .set('Authorization', `Bearer ${trainerB.accessToken}`);
      expect(res.status).toBe(404);
      expect(res.body.errorCode).toBe('NOT_FOUND');

      const own = await request(app.getHttpServer())
        .delete(`/trainers/${trainerB.trainerId}/players/${profile.id}`)
        .set('Authorization', `Bearer ${trainerB.accessToken}`);
      expect(own.status).toBe(404);

      expect(await db.prisma.playerTrainerAssociation.count({ where: { status: 'ACTIVE' } })).toBe(1);
    });

    it('a parent token cannot use it -> 403', async () => {
      const parent = await insertParent();
      const trainer = await insertTrainer();
      await request(app.getHttpServer())
        .delete(`/trainers/${trainer.trainerId}/players/${randomUUID()}`)
        .set('Authorization', `Bearer ${parent.accessToken}`)
        .expect(403);
    });
  });

  describe('GET /trainers/me/players/suggested-times (US-01.09 suggest session times)', () => {
    async function addAvailability(profileId: string, dayOfWeek: number, startHour: number, endHour: number, isAvailable = true) {
      await db.prisma.availability.create({
        data: { subjectType: 'PLAYER', playerProfileId: profileId, dayOfWeek, startTime: startHour * 60, endTime: endHour * 60, isAvailable },
      });
    }

    it('returns the top 3 windows with the most players available, labelled and counted against the roster size', async () => {
      const parent = await insertParent();
      const trainer = await insertTrainer();
      const profiles = [];
      for (const name of ['P1', 'P2', 'P3', 'P4']) {
        const profile = await insertProfile(parent.userId, { name });
        await db.prisma.playerTrainerAssociation.create({ data: { trainerId: trainer.trainerId, playerProfileId: profile.id } });
        profiles.push(profile);
      }
      // Mon 5-8pm: P1+P2+P3. Wed 6-9pm: P1+P2. Fri 9-10am: P4. Sat 8-9am: P4 (4th, dropped). P3 also "not available" Tue (ignored).
      for (const p of [profiles[0]!, profiles[1]!, profiles[2]!]) await addAvailability(p.id, 1, 17, 20);
      for (const p of [profiles[0]!, profiles[1]!]) await addAvailability(p.id, 3, 18, 21);
      await addAvailability(profiles[3]!.id, 5, 9, 10);
      await addAvailability(profiles[3]!.id, 6, 8, 9);
      await addAvailability(profiles[2]!.id, 2, 10, 12, false);

      const res = await request(app.getHttpServer())
        .get('/trainers/me/players/suggested-times')
        .set('Authorization', `Bearer ${trainer.accessToken}`);

      expect(res.status).toBe(200);
      expect(res.body.totalCount).toBe(4);
      expect(res.body.items).toEqual([
        { dayOfWeek: 1, startTime: 1020, endTime: 1200, label: 'Mon 5:00-8:00 PM', availableCount: 3 },
        { dayOfWeek: 3, startTime: 1080, endTime: 1260, label: 'Wed 6:00-9:00 PM', availableCount: 2 },
        { dayOfWeek: 5, startTime: 540, endTime: 600, label: 'Fri 9:00-10:00 AM', availableCount: 1 },
      ]);
    });

    it("is tenant-scoped: another trainer's players and removed players never count", async () => {
      const parent = await insertParent();
      const trainer = await insertTrainer();
      const other = await insertTrainer();
      const mine = await insertProfile(parent.userId, { name: 'Mine' });
      const removed = await insertProfile(parent.userId, { name: 'Removed' });
      const theirs = await insertProfile(parent.userId, { name: 'Theirs' });
      await db.prisma.playerTrainerAssociation.create({ data: { trainerId: trainer.trainerId, playerProfileId: mine.id } });
      await db.prisma.playerTrainerAssociation.create({ data: { trainerId: trainer.trainerId, playerProfileId: removed.id, status: 'INACTIVE' } });
      await db.prisma.playerTrainerAssociation.create({ data: { trainerId: other.trainerId, playerProfileId: theirs.id } });
      for (const p of [mine, removed, theirs]) await addAvailability(p.id, 1, 17, 20);

      const res = await request(app.getHttpServer())
        .get('/trainers/me/players/suggested-times')
        .set('Authorization', `Bearer ${trainer.accessToken}`);

      expect(res.status).toBe(200);
      expect(res.body.totalCount).toBe(1);
      expect(res.body.items).toEqual([expect.objectContaining({ dayOfWeek: 1, availableCount: 1 })]);
    });

    it('a trainer with no players gets an empty list', async () => {
      const trainer = await insertTrainer();

      const res = await request(app.getHttpServer())
        .get('/trainers/me/players/suggested-times')
        .set('Authorization', `Bearer ${trainer.accessToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ items: [], totalCount: 0 });
    });

    it('a parent token -> 403', async () => {
      const parent = await insertParent();
      await request(app.getHttpServer())
        .get('/trainers/me/players/suggested-times')
        .set('Authorization', `Bearer ${parent.accessToken}`)
        .expect(403);
    });
  });

  describe('PATCH /trainers/:id/players/:playerProfileId/skill-level (spec US-01.11, trainer sets it)', () => {
    it('sets the level, shows it on the roster and on the family-side profile read', async () => {
      const parent = await insertParent();
      const trainer = await insertTrainer();
      const profile = await insertProfile(parent.userId);
      await db.prisma.playerTrainerAssociation.create({ data: { trainerId: trainer.trainerId, playerProfileId: profile.id } });

      const res = await request(app.getHttpServer())
        .patch(`/trainers/${trainer.trainerId}/players/${profile.id}/skill-level`)
        .set('Authorization', `Bearer ${trainer.accessToken}`)
        .send({ skillLevel: 'ELITE' });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ playerProfileId: profile.id, skillLevel: 'ELITE' });

      const roster = await request(app.getHttpServer())
        .get(`/trainers/${trainer.trainerId}/players`)
        .set('Authorization', `Bearer ${trainer.accessToken}`);
      expect(roster.body.items[0]).toMatchObject({ playerProfileId: profile.id, skillLevel: 'ELITE' });

      const familyRead = await request(app.getHttpServer())
        .get(`/player-profiles/${profile.id}`)
        .set('Authorization', `Bearer ${parent.accessToken}`);
      expect(familyRead.body.skillLevel).toBe('ELITE');
    });

    it('rejects an unknown level (400) and leaves the stored level untouched', async () => {
      const parent = await insertParent();
      const trainer = await insertTrainer();
      const profile = await insertProfile(parent.userId);
      await db.prisma.playerTrainerAssociation.create({ data: { trainerId: trainer.trainerId, playerProfileId: profile.id } });

      for (const body of [{ skillLevel: 'GOD_MODE' }, {}, { skillLevel: 'advanced' }]) {
        const res = await request(app.getHttpServer())
          .patch(`/trainers/${trainer.trainerId}/players/${profile.id}/skill-level`)
          .set('Authorization', `Bearer ${trainer.accessToken}`)
          .send(body);
        expect(res.status).toBe(400);
      }
      expect((await db.prisma.playerProfile.findUniqueOrThrow({ where: { id: profile.id } })).skillLevel).toBe('BEGINNER');
    });

    it('a trainer who does not have the player on the roster -> 404 (never 403); removed players too', async () => {
      const parent = await insertParent();
      const trainerA = await insertTrainer();
      const trainerB = await insertTrainer();
      const profile = await insertProfile(parent.userId);
      await db.prisma.playerTrainerAssociation.create({ data: { trainerId: trainerA.trainerId, playerProfileId: profile.id } });

      // B writing through A's id, and B writing through its own id, both 404.
      await request(app.getHttpServer())
        .patch(`/trainers/${trainerA.trainerId}/players/${profile.id}/skill-level`)
        .set('Authorization', `Bearer ${trainerB.accessToken}`)
        .send({ skillLevel: 'ADVANCED' })
        .expect(404);
      await request(app.getHttpServer())
        .patch(`/trainers/${trainerB.trainerId}/players/${profile.id}/skill-level`)
        .set('Authorization', `Bearer ${trainerB.accessToken}`)
        .send({ skillLevel: 'ADVANCED' })
        .expect(404);

      await db.prisma.playerTrainerAssociation.updateMany({ where: { trainerId: trainerA.trainerId }, data: { status: 'INACTIVE' } });
      await request(app.getHttpServer())
        .patch(`/trainers/${trainerA.trainerId}/players/${profile.id}/skill-level`)
        .set('Authorization', `Bearer ${trainerA.accessToken}`)
        .send({ skillLevel: 'ADVANCED' })
        .expect(404);

      expect((await db.prisma.playerProfile.findUniqueOrThrow({ where: { id: profile.id } })).skillLevel).toBe('BEGINNER');
    });

    it('a parent cannot set it (403) and PATCH /player-profiles/:id rejects skillLevel (400)', async () => {
      const parent = await insertParent();
      const trainer = await insertTrainer();
      const profile = await insertProfile(parent.userId);
      await db.prisma.playerTrainerAssociation.create({ data: { trainerId: trainer.trainerId, playerProfileId: profile.id } });

      await request(app.getHttpServer())
        .patch(`/trainers/${trainer.trainerId}/players/${profile.id}/skill-level`)
        .set('Authorization', `Bearer ${parent.accessToken}`)
        .send({ skillLevel: 'ELITE' })
        .expect(403);

      const own = await request(app.getHttpServer())
        .patch(`/player-profiles/${profile.id}`)
        .set('Authorization', `Bearer ${parent.accessToken}`)
        .send({ skillLevel: 'ELITE' });
      expect(own.status).toBe(400);
      expect((await db.prisma.playerProfile.findUniqueOrThrow({ where: { id: profile.id } })).skillLevel).toBe('BEGINNER');
    });
  });

  // Task 5.14. RBAC + tenant + child-capability sweep across the
  // associations module, using the Task 3.12 `seedTrainerPair` fixture
  // (trainers.e2e-spec.ts/coaches.e2e-spec.ts's own tenant-isolation
  // convention) rather than this file's local `insertTrainer` helper, so
  // "trainer B cannot read trainer A's roster" is proven against the same
  // reusable two-trainer fixture every other tenant-owned controller's
  // suite already relies on.
  describe('Task 5.14 — RBAC/tenant/child-capability sweep', () => {
    it('tenant isolation (Task 3.12 fixture): trainer B cannot read trainer A\'s roster -> 404', async () => {
      const { trainerA, trainerB } = await seedTrainerPair(db.prisma);
      const accessTokenB = await jwtService.signAsync(
        { sub: trainerB.userId, role: 'TRAINER', typ: 'ADULT', gid: null, tid: trainerB.trainerId, tv: 0, jti: randomUUID() },
        { expiresIn: '15m' },
      );

      const res = await request(app.getHttpServer())
        .get(`/trainers/${trainerA.trainerId}/players`)
        .set('Authorization', `Bearer ${accessTokenB}`);

      expect(res.status).toBe(404);
      expect(res.body.errorCode).toBe('NOT_FOUND');
    });

    it('every CHILD-denied write endpoint consistently reports 403 CHILD_CAPABILITY_DENIED', async () => {
      const parent = await insertParent();
      const trainer = await insertTrainer();
      const childUser = await insertUser({ role: 'PLAYER_PARENT' });
      const profile = await insertProfile(parent.userId, { childUserId: childUser.id });
      await db.prisma.playerTrainerAssociation.create({ data: { trainerId: trainer.trainerId, playerProfileId: profile.id } });
      const childToken = await signToken(childUser, { typ: 'CHILD', gid: parent.userId });

      const attempts = [
        () => request(app.getHttpServer()).post(`/player-profiles/${profile.id}/trainers`).set('Authorization', `Bearer ${childToken}`).send({ trainerId: trainer.trainerId }),
        () => request(app.getHttpServer()).delete(`/player-profiles/${profile.id}/trainers/${trainer.trainerId}`).set('Authorization', `Bearer ${childToken}`),
      ];

      for (const attempt of attempts) {
        const res = await attempt();
        expect(res.status).toBe(403);
        expect(res.body.errorCode).toBe('CHILD_CAPABILITY_DENIED');
      }
    });
  });
});
