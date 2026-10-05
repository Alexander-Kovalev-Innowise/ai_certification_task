import { randomUUID } from 'node:crypto';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import request from 'supertest';

import { resetTestDatabase, startTestDatabase, stopTestDatabase, TestDatabase } from './setup/testcontainers.setup';

// Task 4.11, first endpoint — extended in Task 4.12 (GET /trainers/:id/coaches),
// Task 4.13 (PATCH /coaches/:id) and Task 4.15 (tenant-isolation sweep), same
// convention trainers.e2e-spec.ts/share-links.e2e-spec.ts already established.
describe('CoachesController (e2e, Task 4.11)', () => {
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

  /** Seeds a TRAINER User + TrainerProfile directly, returning both plus a ready-to-use access token. */
  async function insertTrainer(overrides: Record<string, unknown> = {}): Promise<{
    userId: string;
    trainerId: string;
    accessToken: string;
  }> {
    const user = await insertUser({ role: 'TRAINER' });
    const trainerId = randomUUID();
    await db.prisma.trainerProfile.create({
      data: { id: trainerId, userId: user.id, businessName: 'Acme Co', ...overrides },
    });
    const accessToken = await signToken(user, { role: 'TRAINER', tid: trainerId });
    return { userId: user.id, trainerId, accessToken };
  }

  describe('POST /coaches/invite (Task 4.11)', () => {
    it('generates a COACH_UNIQUE link with the invitee’s targetEmail and enqueues the invite email', async () => {
      const trainer = await insertTrainer();
      const targetEmail = `${randomUUID()}@example.com`;

      const res = await request(app.getHttpServer())
        .post('/coaches/invite')
        .set('Authorization', `Bearer ${trainer.accessToken}`)
        .send({ email: targetEmail, name: 'Jordan Coach', message: 'Join us!' });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ status: 'PENDING' });
      expect(res.body.shareLinkCode).toEqual(expect.any(String));
      expect(res.body.expiresAt).not.toBeNull();

      const link = await db.prisma.shareLink.findUnique({ where: { code: res.body.shareLinkCode } });
      expect(link).toMatchObject({ type: 'COACH_UNIQUE', targetEmail, trainerId: trainer.trainerId });

      const jobs = await db.prisma.outboxJob.findMany({ where: { type: 'EMAIL_COACH_INVITE' } });
      expect(jobs).toHaveLength(1);
      expect(jobs[0].payload).toMatchObject({ to: targetEmail });
    });

    it('as a non-trainer role -> 403', async () => {
      const user = await insertUser();
      const accessToken = await signToken(user);

      const res = await request(app.getHttpServer())
        .post('/coaches/invite')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ email: `${randomUUID()}@example.com` });

      expect(res.status).toBe(403);
    });

    it('missing email -> 400 VALIDATION_ERROR', async () => {
      const trainer = await insertTrainer();

      const res = await request(app.getHttpServer())
        .post('/coaches/invite')
        .set('Authorization', `Bearer ${trainer.accessToken}`)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.errorCode).toBe('VALIDATION_ERROR');
    });
  });

  describe('GET /trainers/:id/coaches (Task 4.12)', () => {
    async function insertCoach(trainerId: string, status: 'PENDING' | 'ACTIVE', overrides: Record<string, unknown> = {}) {
      const user = await insertUser({ role: 'COACH', ...overrides });
      const coachProfile = await db.prisma.coachProfile.create({
        data: { userId: user.id, trainerId, status, bio: 'Bio text' },
      });
      return { user, coachProfile };
    }

    it('reflects Accepted, Pending and Expired invitation statuses correctly', async () => {
      const trainer = await insertTrainer();
      const { user: acceptedUser } = await insertCoach(trainer.trainerId, 'ACTIVE');

      const pendingInvite = await db.prisma.shareLink.create({
        data: {
          code: `pending-${randomUUID()}`,
          type: 'COACH_UNIQUE',
          trainerId: trainer.trainerId,
          createdByUserId: trainer.userId,
          targetEmail: `${randomUUID()}@example.com`,
          expiresAt: new Date(Date.now() + 60_000),
        },
      });
      const expiredInvite = await db.prisma.shareLink.create({
        data: {
          code: `expired-${randomUUID()}`,
          type: 'COACH_UNIQUE',
          trainerId: trainer.trainerId,
          createdByUserId: trainer.userId,
          targetEmail: `${randomUUID()}@example.com`,
          expiresAt: new Date(Date.now() - 60_000),
        },
      });

      const res = await request(app.getHttpServer())
        .get(`/trainers/${trainer.trainerId}/coaches`)
        .set('Authorization', `Bearer ${trainer.accessToken}`);

      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(3);

      const accepted = res.body.items.find((r: { email: string }) => r.email === acceptedUser.email);
      expect(accepted).toMatchObject({ invitationStatus: 'Accepted', status: 'ACTIVE', bio: 'Bio text' });

      const pending = res.body.items.find((r: { email: string }) => r.email === pendingInvite.targetEmail);
      expect(pending).toMatchObject({ invitationStatus: 'Pending', userId: null });

      const expired = res.body.items.find((r: { email: string }) => r.email === expiredInvite.targetEmail);
      expect(expired).toMatchObject({ invitationStatus: 'Expired', userId: null });
    });

    it('an accepted invite’s own ShareLink is not double-counted alongside its CoachProfile row', async () => {
      const trainer = await insertTrainer();
      const { user: acceptedUser } = await insertCoach(trainer.trainerId, 'ACTIVE');
      // Simulates the claimed link itself (status flips to EXPIRED on successful accept, arch §9.1).
      await db.prisma.shareLink.create({
        data: {
          code: `claimed-${randomUUID()}`,
          type: 'COACH_UNIQUE',
          trainerId: trainer.trainerId,
          createdByUserId: trainer.userId,
          targetEmail: acceptedUser.email,
          status: 'EXPIRED',
          useCount: 1,
        },
      });

      const res = await request(app.getHttpServer())
        .get(`/trainers/${trainer.trainerId}/coaches`)
        .set('Authorization', `Bearer ${trainer.accessToken}`);

      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0]).toMatchObject({ email: acceptedUser.email, invitationStatus: 'Accepted' });
    });

    it('cross-tenant -> 404 (never 403, arch §8 Layer 3)', async () => {
      const trainerA = await insertTrainer();
      const trainerB = await insertTrainer();
      await insertCoach(trainerA.trainerId, 'ACTIVE');

      const res = await request(app.getHttpServer())
        .get(`/trainers/${trainerA.trainerId}/coaches`)
        .set('Authorization', `Bearer ${trainerB.accessToken}`);

      expect(res.status).toBe(404);
      expect(res.body.errorCode).toBe('NOT_FOUND');
    });
  });

  describe('PATCH /coaches/:id (Task 4.13, dual-actor)', () => {
    async function seedCoach(trainerId: string, overrides: Record<string, unknown> = {}) {
      const user = await insertUser({ role: 'COACH' });
      const coachProfile = await db.prisma.coachProfile.create({
        data: { userId: user.id, trainerId, status: 'ACTIVE', bio: 'Original bio', ...overrides },
      });
      const accessToken = await signToken(user, { role: 'COACH', tid: trainerId });
      return { user, coachProfile, accessToken };
    }

    it('trainer sending status -> 200, updates status', async () => {
      const trainer = await insertTrainer();
      const { coachProfile } = await seedCoach(trainer.trainerId, { status: 'PENDING' });

      const res = await request(app.getHttpServer())
        .patch(`/coaches/${coachProfile.id}`)
        .set('Authorization', `Bearer ${trainer.accessToken}`)
        .send({ status: 'ACTIVE' });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ACTIVE');
    });

    it('trainer sending bio -> 403 FIELD_NOT_ALLOWED_FOR_ROLE, no change persisted', async () => {
      const trainer = await insertTrainer();
      const { coachProfile } = await seedCoach(trainer.trainerId);

      const res = await request(app.getHttpServer())
        .patch(`/coaches/${coachProfile.id}`)
        .set('Authorization', `Bearer ${trainer.accessToken}`)
        .send({ bio: 'Hijacked bio' });

      expect(res.status).toBe(403);
      expect(res.body.errorCode).toBe('FIELD_NOT_ALLOWED_FOR_ROLE');

      const unchanged = await db.prisma.coachProfile.findUnique({ where: { id: coachProfile.id } });
      expect(unchanged?.bio).toBe('Original bio');
    });

    it('coach sending bio/credentials/certifications/publicProfile -> 200, updates those fields', async () => {
      const trainer = await insertTrainer();
      const { coachProfile, accessToken } = await seedCoach(trainer.trainerId);

      const res = await request(app.getHttpServer())
        .patch(`/coaches/${coachProfile.id}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ bio: 'New bio', credentials: 'CPR certified', certifications: 'USSF Level 1', publicProfile: true });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        bio: 'New bio',
        credentials: 'CPR certified',
        certifications: 'USSF Level 1',
        publicProfile: true,
      });
    });

    it('coach sending status -> 403 FIELD_NOT_ALLOWED_FOR_ROLE, no change persisted', async () => {
      const trainer = await insertTrainer();
      const { coachProfile, accessToken } = await seedCoach(trainer.trainerId);

      const res = await request(app.getHttpServer())
        .patch(`/coaches/${coachProfile.id}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ status: 'PENDING' });

      expect(res.status).toBe(403);
      expect(res.body.errorCode).toBe('FIELD_NOT_ALLOWED_FOR_ROLE');

      const unchanged = await db.prisma.coachProfile.findUnique({ where: { id: coachProfile.id } });
      expect(unchanged?.status).toBe('ACTIVE');
    });

    it('a coach cannot update another coach’s profile under the same trainer -> 404', async () => {
      const trainer = await insertTrainer();
      const { coachProfile: otherCoachProfile } = await seedCoach(trainer.trainerId);
      const { accessToken: myAccessToken } = await seedCoach(trainer.trainerId);

      const res = await request(app.getHttpServer())
        .patch(`/coaches/${otherCoachProfile.id}`)
        .set('Authorization', `Bearer ${myAccessToken}`)
        .send({ bio: 'Should not work' });

      expect(res.status).toBe(404);
    });

    it('trainer B cannot update trainer A’s coach -> 404', async () => {
      const trainerA = await insertTrainer();
      const trainerB = await insertTrainer();
      const { coachProfile } = await seedCoach(trainerA.trainerId);

      const res = await request(app.getHttpServer())
        .patch(`/coaches/${coachProfile.id}`)
        .set('Authorization', `Bearer ${trainerB.accessToken}`)
        .send({ status: 'PENDING' });

      expect(res.status).toBe(404);
    });
  });

  describe('Invite hardening (US-01.08)', () => {
    async function seedActiveCoach(trainerId: string) {
      const user = await insertUser({ role: 'COACH' });
      const coachProfile = await db.prisma.coachProfile.create({ data: { userId: user.id, trainerId, status: 'ACTIVE' } });
      return { user, coachProfile };
    }

    it('rejects, at invite time, an email that belongs to an ACTIVE coach of ANOTHER trainer -> 409 COACH_ALREADY_ASSIGNED', async () => {
      const trainerA = await insertTrainer();
      const trainerB = await insertTrainer();
      const { user } = await seedActiveCoach(trainerA.trainerId);

      const res = await request(app.getHttpServer())
        .post('/coaches/invite')
        .set('Authorization', `Bearer ${trainerB.accessToken}`)
        .send({ email: user.email });

      expect(res.status).toBe(409);
      expect(res.body.errorCode).toBe('COACH_ALREADY_ASSIGNED');
      expect(await db.prisma.shareLink.count()).toBe(0);
      expect(await db.prisma.outboxJob.count({ where: { type: 'EMAIL_COACH_INVITE' } })).toBe(0);
    });

    it('rejects an email that is already an ACTIVE coach of the SAME trainer -> 409 COACH_ALREADY_ON_ROSTER', async () => {
      const trainer = await insertTrainer();
      const { user } = await seedActiveCoach(trainer.trainerId);

      const res = await request(app.getHttpServer())
        .post('/coaches/invite')
        .set('Authorization', `Bearer ${trainer.accessToken}`)
        .send({ email: user.email.toUpperCase() });

      expect(res.status).toBe(409);
      expect(res.body.errorCode).toBe('COACH_ALREADY_ON_ROSTER');
    });

    it('a removed (INACTIVE) coach can be invited again by another trainer', async () => {
      const trainerA = await insertTrainer();
      const trainerB = await insertTrainer();
      const { user, coachProfile } = await seedActiveCoach(trainerA.trainerId);
      await db.prisma.coachProfile.update({ where: { id: coachProfile.id }, data: { status: 'INACTIVE' } });

      const res = await request(app.getHttpServer())
        .post('/coaches/invite')
        .set('Authorization', `Bearer ${trainerB.accessToken}`)
        .send({ email: user.email });

      expect(res.status).toBe(201);
    });

    it('re-inviting the same email replaces the outstanding link (one roster row)', async () => {
      const trainer = await insertTrainer();
      const email = `${randomUUID()}@example.com`;
      for (let i = 0; i < 2; i += 1) {
        await request(app.getHttpServer())
          .post('/coaches/invite')
          .set('Authorization', `Bearer ${trainer.accessToken}`)
          .send({ email })
          .expect(201);
      }

      const roster = await request(app.getHttpServer())
        .get(`/trainers/${trainer.trainerId}/coaches`)
        .set('Authorization', `Bearer ${trainer.accessToken}`);
      expect(roster.body.items).toHaveLength(1);
      expect(await db.prisma.shareLink.count({ where: { status: 'REVOKED' } })).toBe(1);
    });
  });

  describe('POST /coaches/invites/:id/resend (US-01.08)', () => {
    async function seedInvite(trainer: { trainerId: string; userId: string }, overrides: Record<string, unknown> = {}) {
      return db.prisma.shareLink.create({
        data: {
          code: `inv-${randomUUID()}`,
          type: 'COACH_UNIQUE',
          trainerId: trainer.trainerId,
          createdByUserId: trainer.userId,
          targetEmail: `${randomUUID()}@example.com`,
          expiresAt: new Date(Date.now() - 60_000),
          status: 'EXPIRED',
          ...overrides,
        },
      });
    }

    it('revokes the old link, issues a fresh 7-day link, re-sends the email, and leaves exactly one roster row', async () => {
      const trainer = await insertTrainer();
      const old = await seedInvite(trainer);

      const res = await request(app.getHttpServer())
        .post(`/coaches/invites/${old.id}/resend`)
        .set('Authorization', `Bearer ${trainer.accessToken}`);

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('PENDING');
      expect(res.body.id).not.toBe(old.id);
      expect(res.body.shareLinkCode).not.toBe(old.code);
      const msLeft = new Date(res.body.expiresAt).getTime() - Date.now();
      expect(msLeft).toBeGreaterThan(6.9 * 24 * 3600 * 1000);

      expect((await db.prisma.shareLink.findUnique({ where: { id: old.id } }))?.status).toBe('REVOKED');
      const jobs = await db.prisma.outboxJob.findMany({ where: { type: 'EMAIL_COACH_INVITE' } });
      expect(jobs).toHaveLength(1);
      expect(jobs[0].payload).toMatchObject({ to: old.targetEmail });

      const roster = await request(app.getHttpServer())
        .get(`/trainers/${trainer.trainerId}/coaches`)
        .set('Authorization', `Bearer ${trainer.accessToken}`);
      expect(roster.body.items).toHaveLength(1);
      expect(roster.body.items[0]).toMatchObject({ id: res.body.id, email: old.targetEmail, invitationStatus: 'Pending' });
    });

    it("another trainer's invite -> 404; an unknown id -> 404", async () => {
      const trainerA = await insertTrainer();
      const trainerB = await insertTrainer();
      const old = await seedInvite(trainerA);

      await request(app.getHttpServer())
        .post(`/coaches/invites/${old.id}/resend`)
        .set('Authorization', `Bearer ${trainerB.accessToken}`)
        .expect(404);
      await request(app.getHttpServer())
        .post(`/coaches/invites/${randomUUID()}/resend`)
        .set('Authorization', `Bearer ${trainerA.accessToken}`)
        .expect(404);
    });

    it('an already-accepted (claimed) invite -> 409 INVITE_ALREADY_ACCEPTED', async () => {
      const trainer = await insertTrainer();
      const old = await seedInvite(trainer, { useCount: 1 });

      const res = await request(app.getHttpServer())
        .post(`/coaches/invites/${old.id}/resend`)
        .set('Authorization', `Bearer ${trainer.accessToken}`);

      expect(res.status).toBe(409);
      expect(res.body.errorCode).toBe('INVITE_ALREADY_ACCEPTED');
    });

    it('if the email has since become an ACTIVE coach of another trainer -> 409 COACH_ALREADY_ASSIGNED', async () => {
      const trainerA = await insertTrainer();
      const trainerB = await insertTrainer();
      const coachUser = await insertUser({ role: 'COACH' });
      await db.prisma.coachProfile.create({ data: { userId: coachUser.id, trainerId: trainerB.trainerId, status: 'ACTIVE' } });
      const old = await seedInvite(trainerA, { targetEmail: coachUser.email });

      const res = await request(app.getHttpServer())
        .post(`/coaches/invites/${old.id}/resend`)
        .set('Authorization', `Bearer ${trainerA.accessToken}`);

      expect(res.status).toBe(409);
      expect(res.body.errorCode).toBe('COACH_ALREADY_ASSIGNED');
    });

    it('a non-trainer -> 403', async () => {
      const user = await insertUser();
      const accessToken = await signToken(user);
      await request(app.getHttpServer())
        .post(`/coaches/invites/${randomUUID()}/resend`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(403);
    });
  });

  describe('GET /trainers/:id/coaches keyset pagination (US-01.08)', () => {
    it('pages profiles then invites with a real cursor, no duplicates, nextCursor null at the end', async () => {
      const trainer = await insertTrainer();
      for (let i = 0; i < 3; i += 1) {
        const user = await insertUser({ role: 'COACH' });
        await db.prisma.coachProfile.create({
          data: { userId: user.id, trainerId: trainer.trainerId, status: 'ACTIVE', joinedAt: new Date(Date.now() - i * 1000) },
        });
      }
      for (let i = 0; i < 2; i += 1) {
        await db.prisma.shareLink.create({
          data: {
            code: `p-${randomUUID()}`,
            type: 'COACH_UNIQUE',
            trainerId: trainer.trainerId,
            createdByUserId: trainer.userId,
            targetEmail: `${randomUUID()}@example.com`,
            expiresAt: new Date(Date.now() + 60_000),
            createdAt: new Date(Date.now() - i * 1000),
          },
        });
      }
      // A removed coach never shows up.
      const removed = await insertUser({ role: 'COACH' });
      await db.prisma.coachProfile.create({ data: { userId: removed.id, trainerId: trainer.trainerId, status: 'INACTIVE' } });

      const seen: string[] = [];
      let cursor: string | null = null;
      let pages = 0;
      do {
        const res: request.Response = await request(app.getHttpServer())
          .get(`/trainers/${trainer.trainerId}/coaches`)
          .query({ limit: 2, ...(cursor ? { cursor } : {}) })
          .set('Authorization', `Bearer ${trainer.accessToken}`);
        expect(res.status).toBe(200);
        expect(res.body.items.length).toBeLessThanOrEqual(2);
        seen.push(...res.body.items.map((r: { id: string }) => r.id));
        cursor = res.body.nextCursor;
        expect(res.body.hasMore).toBe(cursor !== null);
        pages += 1;
      } while (cursor && pages < 10);

      expect(pages).toBe(3);
      expect(seen).toHaveLength(5);
      expect(new Set(seen).size).toBe(5);
    });

    it('a malformed cursor -> 400 VALIDATION_ERROR', async () => {
      const trainer = await insertTrainer();
      const res = await request(app.getHttpServer())
        .get(`/trainers/${trainer.trainerId}/coaches`)
        .query({ cursor: 'not-a-cursor' })
        .set('Authorization', `Bearer ${trainer.accessToken}`);
      expect(res.status).toBe(400);
      expect(res.body.errorCode).toBe('VALIDATION_ERROR');
    });
  });

  describe('DELETE /coaches/:id (remove from organisation)', () => {
    async function seedCoachWithToken(trainerId: string) {
      const user = await insertUser({ role: 'COACH' });
      const coachProfile = await db.prisma.coachProfile.create({ data: { userId: user.id, trainerId, status: 'ACTIVE' } });
      const accessToken = await signToken(user, { role: 'COACH', tid: trainerId });
      return { user, coachProfile, accessToken };
    }

    it('marks the coach INACTIVE (history kept), bumps tokenVersion, drops them from the roster, and the coach can no longer act', async () => {
      const trainer = await insertTrainer();
      const { user, coachProfile, accessToken } = await seedCoachWithToken(trainer.trainerId);

      await request(app.getHttpServer())
        .delete(`/coaches/${coachProfile.id}`)
        .set('Authorization', `Bearer ${trainer.accessToken}`)
        .expect(204);

      const row = await db.prisma.coachProfile.findUnique({ where: { id: coachProfile.id } });
      expect(row?.status).toBe('INACTIVE');
      expect((await db.prisma.user.findUnique({ where: { id: user.id } }))?.tokenVersion).toBe(1);

      const roster = await request(app.getHttpServer())
        .get(`/trainers/${trainer.trainerId}/coaches`)
        .set('Authorization', `Bearer ${trainer.accessToken}`);
      expect(roster.body.items).toHaveLength(0);

      // The old session is revoked outright (tokenVersion mismatch)…
      await request(app.getHttpServer())
        .patch(`/coaches/${coachProfile.id}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ bio: 'still here?' })
        .expect(401);
      // …and even a token that somehow still validates cannot edit the removed profile.
      const freshToken = await signToken(user, { role: 'COACH', tid: trainer.trainerId, tv: 1 });
      await request(app.getHttpServer())
        .patch(`/coaches/${coachProfile.id}`)
        .set('Authorization', `Bearer ${freshToken}`)
        .send({ bio: 'still here?' })
        .expect(404);
      // The trainer cannot revive the removed coach through PATCH either.
      await request(app.getHttpServer())
        .patch(`/coaches/${coachProfile.id}`)
        .set('Authorization', `Bearer ${trainer.accessToken}`)
        .send({ status: 'ACTIVE' })
        .expect(404);
    });

    it("another trainer's coach -> 404 and nothing changes; a second removal -> 404", async () => {
      const trainerA = await insertTrainer();
      const trainerB = await insertTrainer();
      const { coachProfile } = await seedCoachWithToken(trainerA.trainerId);

      await request(app.getHttpServer())
        .delete(`/coaches/${coachProfile.id}`)
        .set('Authorization', `Bearer ${trainerB.accessToken}`)
        .expect(404);
      expect((await db.prisma.coachProfile.findUnique({ where: { id: coachProfile.id } }))?.status).toBe('ACTIVE');

      await request(app.getHttpServer())
        .delete(`/coaches/${coachProfile.id}`)
        .set('Authorization', `Bearer ${trainerA.accessToken}`)
        .expect(204);
      await request(app.getHttpServer())
        .delete(`/coaches/${coachProfile.id}`)
        .set('Authorization', `Bearer ${trainerA.accessToken}`)
        .expect(404);
    });

    it('a coach cannot remove a coach -> 403', async () => {
      const trainer = await insertTrainer();
      const { coachProfile, accessToken } = await seedCoachWithToken(trainer.trainerId);
      await request(app.getHttpServer())
        .delete(`/coaches/${coachProfile.id}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(403);
    });
  });
});
