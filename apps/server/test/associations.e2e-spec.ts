import { randomUUID } from 'node:crypto';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import request from 'supertest';

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
});
