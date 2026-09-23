import { randomUUID } from 'node:crypto';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import request from 'supertest';

import { resetTestDatabase, startTestDatabase, stopTestDatabase, TestDatabase } from './setup/testcontainers.setup';

// Task 5.12, first endpoint (GET /approvals) — extended in Task 5.13
// (POST /approvals/:id/approve, POST /approvals/:id/deny, the 5-minute
// expiry sweep) and Task 5.14's RBAC/tenant/child-capability sweep, same
// convention every other Phase 5 spec file already established.
describe('ChildApprovalsController (e2e, Task 5.12)', () => {
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

  async function insertApproval(playerProfileId: string, parentUserId: string, overrides: Record<string, unknown> = {}) {
    return db.prisma.childPurchaseApproval.create({
      data: {
        playerProfileId,
        parentUserId,
        eventId: randomUUID(),
        amount: '25.00',
        paymentType: 'USD',
        status: 'PENDING',
        expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
        ...overrides,
      },
    });
  }

  describe('GET /approvals (Task 5.12)', () => {
    it("a parent sees only their own children's requests", async () => {
      const parent = await insertParent();
      const stranger = await insertParent();
      const profile = await insertProfile(parent.userId);
      const strangerProfile = await insertProfile(stranger.userId);
      const mine = await insertApproval(profile.id, parent.userId);
      await insertApproval(strangerProfile.id, stranger.userId);

      const res = await request(app.getHttpServer())
        .get('/approvals')
        .set('Authorization', `Bearer ${parent.accessToken}`);

      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0]).toMatchObject({ id: mine.id, playerProfileId: profile.id, playerName: 'Kid One', status: 'PENDING' });
    });

    it('a status filter narrows results', async () => {
      const parent = await insertParent();
      const profile = await insertProfile(parent.userId);
      await insertApproval(profile.id, parent.userId, { status: 'PENDING' });
      await insertApproval(profile.id, parent.userId, { status: 'DENIED', respondedAt: new Date() });

      const res = await request(app.getHttpServer())
        .get('/approvals')
        .query({ status: 'DENIED' })
        .set('Authorization', `Bearer ${parent.accessToken}`);

      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0].status).toBe('DENIED');
    });

    it('a CHILD session -> 403 CHILD_CAPABILITY_DENIED', async () => {
      const parent = await insertParent();
      const childUser = await insertUser({ role: 'PLAYER_PARENT' });
      const childToken = await signToken(childUser, { typ: 'CHILD', gid: parent.userId });

      const res = await request(app.getHttpServer())
        .get('/approvals')
        .set('Authorization', `Bearer ${childToken}`);

      expect(res.status).toBe(403);
      expect(res.body.errorCode).toBe('CHILD_CAPABILITY_DENIED');
    });
  });
});
