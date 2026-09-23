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
});
