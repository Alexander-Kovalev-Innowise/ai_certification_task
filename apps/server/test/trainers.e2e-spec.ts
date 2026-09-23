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
});
