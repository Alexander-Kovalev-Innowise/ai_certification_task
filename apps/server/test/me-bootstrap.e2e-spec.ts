import { randomUUID } from 'node:crypto';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import request from 'supertest';

import { resetTestDatabase, startTestDatabase, stopTestDatabase, TestDatabase } from './setup/testcontainers.setup';

// Gap-fill: api §5 "GET /me/bootstrap" (OQ-4), arch §14/NFR-001. Phase 9's
// DoD sweep found this endpoint had been referenced as existing
// infrastructure by every prior phase (users.controller.ts's Task 2.22 GET/
// PATCH /me, the dashboard-load NFR in the architecture doc) without any
// phase ever having implemented it. Same testcontainers/direct-JWT-signing
// convention every other Phase 5+ e2e file already established (per the
// plan's own pitfall note: sign tokens directly via `signToken`, never
// repeated real `/auth/login` calls) — the one deliberate exception is the
// impersonation case below, which genuinely needs a real
// `POST /impersonation/start` call, since that IS the mechanism under test.
describe('UsersController — GET /me/bootstrap (e2e, gap-fill)', () => {
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

  async function insertSuperAdmin(): Promise<{ userId: string; accessToken: string }> {
    const user = await insertUser({ role: 'SUPER_ADMIN' });
    const accessToken = await signToken(user, { role: 'SUPER_ADMIN' });
    return { userId: user.id, accessToken };
  }

  async function insertTrainer(overrides: Record<string, unknown> = {}): Promise<{ userId: string; trainerId: string; accessToken: string }> {
    const user = await insertUser({ role: 'TRAINER' });
    const trainerId = randomUUID();
    await db.prisma.trainerProfile.create({
      data: { id: trainerId, userId: user.id, businessName: 'Acme Co', logoUrl: 'https://example.com/logo.png', primaryColorHex: '#123456', ...overrides },
    });
    const accessToken = await signToken(user, { role: 'TRAINER', tid: trainerId });
    return { userId: user.id, trainerId, accessToken };
  }

  async function insertCoach(trainerId: string, overrides: Record<string, unknown> = {}): Promise<{ userId: string; coachProfileId: string; accessToken: string }> {
    const user = await insertUser({ role: 'COACH' });
    const coachProfile = await db.prisma.coachProfile.create({
      data: { userId: user.id, trainerId, status: 'ACTIVE', bio: 'Bio text', ...overrides },
    });
    const accessToken = await signToken(user, { role: 'COACH', tid: trainerId });
    return { userId: user.id, coachProfileId: coachProfile.id, accessToken };
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

  it('unauthenticated -> 401', async () => {
    const res = await request(app.getHttpServer()).get('/me/bootstrap');
    expect(res.status).toBe(401);
  });

  it('SUPER_ADMIN gets the minimal {role, user} shape, no dashboard aggregation', async () => {
    const admin = await insertSuperAdmin();

    const res = await request(app.getHttpServer()).get('/me/bootstrap').set('Authorization', `Bearer ${admin.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ role: 'SUPER_ADMIN', user: { id: admin.userId, role: 'SUPER_ADMIN' } });
    expect(res.body.trainerProfile).toBeUndefined();
    expect(res.body.coachProfile).toBeUndefined();
    expect(res.body.playerProfiles).toBeUndefined();
  });

  it('TRAINER gets trainerProfile + branding + coachCount + activePlayerCount, ACTIVE-only', async () => {
    const trainer = await insertTrainer({ businessName: 'Elite FC' });
    await insertCoach(trainer.trainerId, { status: 'ACTIVE' });
    await insertCoach(trainer.trainerId, { status: 'PENDING' }); // must NOT count

    const parent = await insertParent();
    const activeProfile = await insertProfile(parent.userId, { name: 'Active Kid' });
    const removedProfile = await insertProfile(parent.userId, { name: 'Removed Kid' });
    await db.prisma.playerTrainerAssociation.create({ data: { trainerId: trainer.trainerId, playerProfileId: activeProfile.id } });
    await db.prisma.playerTrainerAssociation.create({
      data: { trainerId: trainer.trainerId, playerProfileId: removedProfile.id, status: 'INACTIVE', disconnectedAt: new Date() },
    });

    const res = await request(app.getHttpServer()).get('/me/bootstrap').set('Authorization', `Bearer ${trainer.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      role: 'TRAINER',
      user: { id: trainer.userId, role: 'TRAINER' },
      trainerProfile: { id: trainer.trainerId, businessName: 'Elite FC' },
      branding: { logoUrl: 'https://example.com/logo.png', primaryColorHex: '#123456' },
      coachCount: 1,
      activePlayerCount: 1,
    });
  });

  it('COACH gets coachProfile + employingTrainer + availabilitySet:false with no slots saved yet', async () => {
    const trainer = await insertTrainer({ businessName: 'Elite FC' });
    const coach = await insertCoach(trainer.trainerId, { bio: 'Speed and agility' });

    const res = await request(app.getHttpServer()).get('/me/bootstrap').set('Authorization', `Bearer ${coach.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      role: 'COACH',
      user: { id: coach.userId, role: 'COACH' },
      coachProfile: { id: coach.coachProfileId, trainerId: trainer.trainerId, bio: 'Speed and agility' },
      employingTrainer: { id: trainer.trainerId, businessName: 'Elite FC' },
      availabilitySet: false,
    });
  });

  it('COACH gets availabilitySet:true once "My Times" has been saved', async () => {
    const trainer = await insertTrainer();
    const coach = await insertCoach(trainer.trainerId);
    await db.prisma.availability.create({
      data: { subjectType: 'COACH', coachProfileId: coach.coachProfileId, dayOfWeek: 1, startTime: 540, endTime: 600, isAvailable: true },
    });

    const res = await request(app.getHttpServer()).get('/me/bootstrap').set('Authorization', `Bearer ${coach.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.availabilitySet).toBe(true);
  });

  it('PLAYER_PARENT (ADULT) gets self+children playerProfiles, contexts and pendingApprovalsCount', async () => {
    const parent = await insertParent();
    const trainer = await insertTrainer({ businessName: 'Elite FC' });
    const selfProfile = await insertProfile(parent.userId, { isSelf: true, name: 'Parent Self' });
    const childProfile = await insertProfile(parent.userId, { name: 'Kid One' });
    await db.prisma.playerTrainerAssociation.create({ data: { trainerId: trainer.trainerId, playerProfileId: selfProfile.id } });
    await db.prisma.playerTrainerAssociation.create({ data: { trainerId: trainer.trainerId, playerProfileId: childProfile.id } });

    await db.prisma.childPurchaseApproval.create({
      data: {
        playerProfileId: childProfile.id,
        parentUserId: parent.userId,
        eventId: randomUUID(),
        amount: '25.00',
        paymentType: 'USD',
        status: 'PENDING',
        expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
      },
    });
    await db.prisma.childPurchaseApproval.create({
      data: {
        playerProfileId: childProfile.id,
        parentUserId: parent.userId,
        eventId: randomUUID(),
        amount: '10.00',
        paymentType: 'USD',
        status: 'APPROVED',
        respondedAt: new Date(),
        expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
      },
    });

    const res = await request(app.getHttpServer()).get('/me/bootstrap').set('Authorization', `Bearer ${parent.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.role).toBe('PLAYER_PARENT');
    expect(res.body.accountType).toBe('ADULT');
    expect(res.body.user).toMatchObject({ id: parent.userId });
    expect(res.body.playerProfiles).toHaveLength(2);
    expect(res.body.playerProfile).toBeUndefined();
    expect(res.body.contexts).toHaveLength(2);
    expect(res.body.activeContext).toBeNull();
    expect(res.body.pendingApprovalsCount).toBe(1);
  });

  it('PLAYER_PARENT (CHILD typ) gets only its own playerProfile (singular), no pendingApprovalsCount', async () => {
    const parent = await insertParent();
    const childUser = await insertUser();
    await insertProfile(parent.userId, { childUserId: childUser.id, name: 'Kid One' });
    const childToken = await signToken(childUser, { typ: 'CHILD', gid: parent.userId });

    const res = await request(app.getHttpServer()).get('/me/bootstrap').set('Authorization', `Bearer ${childToken}`);

    expect(res.status).toBe(200);
    expect(res.body.role).toBe('PLAYER_PARENT');
    expect(res.body.accountType).toBe('CHILD');
    expect(res.body.playerProfile).toMatchObject({ name: 'Kid One' });
    expect(res.body.playerProfiles).toBeUndefined();
    expect(res.body.pendingApprovalsCount).toBeUndefined();
  });

  it('with a valid X-Trainer-Context header, echoes activeContext populated', async () => {
    const parent = await insertParent();
    const trainer = await insertTrainer({ businessName: 'Elite FC' });
    const profile = await insertProfile(parent.userId, { isSelf: true, name: 'Parent Self' });
    await db.prisma.playerTrainerAssociation.create({ data: { trainerId: trainer.trainerId, playerProfileId: profile.id } });

    const res = await request(app.getHttpServer())
      .get('/me/bootstrap')
      .set('Authorization', `Bearer ${parent.accessToken}`)
      .set('X-Trainer-Context', trainer.trainerId);

    expect(res.status).toBe(200);
    expect(res.body.activeContext).toMatchObject({ trainerId: trainer.trainerId, trainerDisplayName: 'Elite FC' });
  });

  it('with an X-Trainer-Context that matches no active association -> 403 TENANT_CONTEXT_INVALID', async () => {
    const parent = await insertParent();
    const trainer = await insertTrainer();
    const profile = await insertProfile(parent.userId, { isSelf: true });
    await db.prisma.playerTrainerAssociation.create({ data: { trainerId: trainer.trainerId, playerProfileId: profile.id } });

    const res = await request(app.getHttpServer())
      .get('/me/bootstrap')
      .set('Authorization', `Bearer ${parent.accessToken}`)
      .set('X-Trainer-Context', randomUUID());

    expect(res.status).toBe(403);
    expect(res.body.errorCode).toBe('TENANT_CONTEXT_INVALID');
  });

  it('an active impersonation session returns the TARGET role\'s bootstrap shape, not the admin\'s own', async () => {
    const admin = await insertSuperAdmin();
    const target = await insertTrainer({ businessName: 'Impersonated Co' });

    const startRes = await request(app.getHttpServer())
      .post('/impersonation/start')
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ targetUserId: target.userId });
    expect(startRes.status).toBe(201);
    const impersonationToken = startRes.body.accessToken as string;

    const res = await request(app.getHttpServer()).get('/me/bootstrap').set('Authorization', `Bearer ${impersonationToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      role: 'TRAINER',
      user: { id: target.userId, role: 'TRAINER' },
      trainerProfile: { id: target.trainerId, businessName: 'Impersonated Co' },
    });
  });
});
