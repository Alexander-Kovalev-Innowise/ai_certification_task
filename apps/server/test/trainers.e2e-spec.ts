import { randomUUID } from 'node:crypto';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import request from 'supertest';

import { resetTestDatabase, startTestDatabase, stopTestDatabase, TestDatabase } from './setup/testcontainers.setup';

// Task 3.8 onward — POST /trainers (Super Admin creates trainer account),
// extended in Task 3.9 (GET/PATCH /trainers/:id), Task 3.11 (consolidated
// integration coverage) and Task 3.12 (mandatory tenant-isolation sweep).
describe('TrainersController (e2e, Task 3.8)', () => {
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

  function createTrainerDto(overrides: Record<string, unknown> = {}) {
    return {
      businessName: 'Acme Training',
      firstName: 'Trainer',
      lastName: 'One',
      email: `${randomUUID()}@example.com`,
      phone: '+14155552671',
      ...overrides,
    };
  }

  /** Seeds a TRAINER User + TrainerProfile directly (bypassing POST /trainers), returning both plus a ready-to-use access token. */
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

  it('POST /trainers as Super Admin creates exactly one User+TrainerProfile+setup token+outbox job, returns 201 TrainerResponseDto', async () => {
    const admin = await insertUser({ role: 'SUPER_ADMIN' });
    const accessToken = await signToken(admin);
    const dto = createTrainerDto();

    const res = await request(app.getHttpServer())
      .post('/trainers')
      .set('Authorization', `Bearer ${accessToken}`)
      .send(dto);

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ businessName: dto.businessName, email: dto.email, status: 'Active' });
    expect(res.body.id).toEqual(expect.any(String));
    expect(res.body.userId).toEqual(expect.any(String));

    const user = await db.prisma.user.findUnique({ where: { email: dto.email } });
    expect(user).not.toBeNull();
    expect(user?.role).toBe('TRAINER');
    expect(user?.mustChangePassword).toBe(true);

    const trainerProfile = await db.prisma.trainerProfile.findUnique({ where: { userId: user!.id } });
    expect(trainerProfile).not.toBeNull();

    const setupTokens = await db.prisma.passwordResetToken.findMany({ where: { userId: user!.id, purpose: 'TRAINER_SETUP' } });
    expect(setupTokens).toHaveLength(1);

    const outboxJobs = await db.prisma.outboxJob.findMany({ where: { type: 'EMAIL_TRAINER_INVITE' } });
    expect(outboxJobs).toHaveLength(1);

    // OQ-8: no password is ever generated for/emailed to the trainer.
    expect(JSON.stringify(res.body)).not.toMatch(/password/i);
  });

  it('POST /trainers with a duplicate email -> 409 CONFLICT', async () => {
    const admin = await insertUser({ role: 'SUPER_ADMIN' });
    const accessToken = await signToken(admin);
    const existing = await insertUser();

    const res = await request(app.getHttpServer())
      .post('/trainers')
      .set('Authorization', `Bearer ${accessToken}`)
      .send(createTrainerDto({ email: existing.email }));

    expect(res.status).toBe(409);
    expect(res.body.errorCode).toBe('CONFLICT');
  });

  it('POST /trainers as a non-Super-Admin -> 403', async () => {
    const user = await insertUser();
    const accessToken = await signToken(user);

    const res = await request(app.getHttpServer())
      .post('/trainers')
      .set('Authorization', `Bearer ${accessToken}`)
      .send(createTrainerDto());

    expect(res.status).toBe(403);
  });

  it('POST /trainers with an invalid body -> 400 VALIDATION_ERROR', async () => {
    const admin = await insertUser({ role: 'SUPER_ADMIN' });
    const accessToken = await signToken(admin);

    const res = await request(app.getHttpServer())
      .post('/trainers')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ businessName: 'Acme' }); // missing firstName/lastName/email/phone

    expect(res.status).toBe(400);
    expect(res.body.errorCode).toBe('VALIDATION_ERROR');
  });

  it('GET /trainers/:id — owning trainer can read their own profile', async () => {
    const trainer = await insertTrainer({ businessName: 'Owner Co' });

    const res = await request(app.getHttpServer())
      .get(`/trainers/${trainer.trainerId}`)
      .set('Authorization', `Bearer ${trainer.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: trainer.trainerId, userId: trainer.userId, businessName: 'Owner Co' });
    expect(res.body.stripeCustomerId).toBeUndefined();
    expect(res.body.subscriptionStatus).toBeUndefined();
    expect(res.body.platformFeePercent).toBeUndefined();
  });

  it('GET /trainers/:id — a different trainer -> 404 (never 403, arch §8 Layer 3)', async () => {
    const trainerA = await insertTrainer({ businessName: 'Trainer A Co' });
    const trainerB = await insertTrainer({ businessName: 'Trainer B Co' });

    const res = await request(app.getHttpServer())
      .get(`/trainers/${trainerA.trainerId}`)
      .set('Authorization', `Bearer ${trainerB.accessToken}`);

    expect(res.status).toBe(404);
    expect(res.body.errorCode).toBe('NOT_FOUND');
  });

  it('GET /trainers/:id — Super Admin can read any trainer', async () => {
    const admin = await insertUser({ role: 'SUPER_ADMIN' });
    const adminToken = await signToken(admin);
    const trainer = await insertTrainer({ businessName: 'Some Co' });

    const res = await request(app.getHttpServer())
      .get(`/trainers/${trainer.trainerId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.businessName).toBe('Some Co');
  });

  it('PATCH /trainers/:id — owning trainer can edit their own business details', async () => {
    const trainer = await insertTrainer({ businessName: 'Before' });

    const res = await request(app.getHttpServer())
      .patch(`/trainers/${trainer.trainerId}`)
      .set('Authorization', `Bearer ${trainer.accessToken}`)
      .send({ businessName: 'After', address: '123 Main St' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ businessName: 'After', address: '123 Main St' });
  });

  it('PATCH /trainers/:id — a different trainer -> 404', async () => {
    const trainerA = await insertTrainer({ businessName: 'Trainer A Co' });
    const trainerB = await insertTrainer({ businessName: 'Trainer B Co' });

    const res = await request(app.getHttpServer())
      .patch(`/trainers/${trainerA.trainerId}`)
      .set('Authorization', `Bearer ${trainerB.accessToken}`)
      .send({ businessName: 'Hijacked' });

    expect(res.status).toBe(404);

    const unchanged = await db.prisma.trainerProfile.findUnique({ where: { id: trainerA.trainerId } });
    expect(unchanged?.businessName).toBe('Trainer A Co');
  });

  it('PATCH /trainers/:id — Super Admin can edit any trainer', async () => {
    const admin = await insertUser({ role: 'SUPER_ADMIN' });
    const adminToken = await signToken(admin);
    const trainer = await insertTrainer({ businessName: 'Before' });

    const res = await request(app.getHttpServer())
      .patch(`/trainers/${trainer.trainerId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ description: 'Edited by admin' });

    expect(res.status).toBe(200);
    expect(res.body.description).toBe('Edited by admin');
  });

  it('GET /trainers/:id as a non-trainer, non-Super-Admin role -> 403', async () => {
    const user = await insertUser();
    const accessToken = await signToken(user);
    const trainer = await insertTrainer();

    const res = await request(app.getHttpServer())
      .get(`/trainers/${trainer.trainerId}`)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(403);
  });

  // Task 3.11 — consolidated integration coverage. Duplicate-email conflict
  // already has a dedicated test above (Task 3.8); this closes the one
  // remaining integration gap — the full create -> read round trip through
  // the real POST /trainers endpoint (Task 3.9's GET tests all seed their
  // TrainerProfile directly, never via the actual creation flow), proving
  // the `tid` claim the trainer would receive on login/setup-completion
  // really does resolve to the TrainerProfile POST /trainers just created.
  it('POST /trainers then GET /trainers/:id (as the newly created trainer) round-trips end to end', async () => {
    const admin = await insertUser({ role: 'SUPER_ADMIN' });
    const adminToken = await signToken(admin);
    const dto = createTrainerDto({ businessName: 'Round Trip Co' });

    const createRes = await request(app.getHttpServer())
      .post('/trainers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(dto);
    expect(createRes.status).toBe(201);

    // A freshly created trainer has mustChangePassword: true, which blocks
    // every route except /auth/change-password, /auth/logout, /me
    // (CapabilitiesGuard's PASSWORD_CHANGE_REQUIRED, arch §6.6) — simulate
    // that they already completed setup (Task 2.20's completeTrainerSetup
    // clears this same flag) so this round trip can reach GET /trainers/:id.
    await db.prisma.user.update({ where: { id: createRes.body.userId }, data: { mustChangePassword: false } });
    const createdUser = await db.prisma.user.findUnique({ where: { id: createRes.body.userId } });
    const trainerAccessToken = await signToken(
      { id: createdUser!.id, role: 'TRAINER' },
      { tid: createRes.body.id },
    );

    const getRes = await request(app.getHttpServer())
      .get(`/trainers/${createRes.body.id}`)
      .set('Authorization', `Bearer ${trainerAccessToken}`);

    expect(getRes.status).toBe(200);
    expect(getRes.body).toMatchObject({ id: createRes.body.id, userId: createRes.body.userId, businessName: 'Round Trip Co' });
  });
});
