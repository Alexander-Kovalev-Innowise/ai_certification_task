import { randomUUID } from 'node:crypto';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import request from 'supertest';

import { resetTestDatabase, startTestDatabase, stopTestDatabase, TestDatabase } from './setup/testcontainers.setup';

// GET /dashboard/stats — role-aware dashboard metrics. Same testcontainers /
// direct-JWT-signing convention as me-bootstrap.e2e-spec.ts. Proves (a) the
// per-role response shapes, (b) tenant isolation (trainer A's numbers never
// include trainer B's rows), and (c) an impersonated session sees the
// target's dashboard.
describe('DashboardController — GET /dashboard/stats (e2e)', () => {
  jest.setTimeout(180_000);

  let db: TestDatabase;
  let app: INestApplication;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamically required after DATABASE_URL is set
  let jwtService: any;

  const originalDatabaseUrl = process.env.DATABASE_URL;
  const KNOWN_PASSWORD = 'CorrectHorseBattery1';
  const DAY_MS = 24 * 60 * 60 * 1000;

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

  async function insertSuperAdmin() {
    const user = await insertUser({ role: 'SUPER_ADMIN' });
    return { userId: user.id, accessToken: await signToken(user, { role: 'SUPER_ADMIN' }) };
  }

  async function insertTrainer(overrides: Record<string, unknown> = {}) {
    const user = await insertUser({ role: 'TRAINER' });
    const trainerId = randomUUID();
    await db.prisma.trainerProfile.create({ data: { id: trainerId, userId: user.id, businessName: 'Acme Co', ...overrides } });
    return { userId: user.id, trainerId, accessToken: await signToken(user, { role: 'TRAINER', tid: trainerId }) };
  }

  async function insertCoach(trainerId: string, overrides: Record<string, unknown> = {}) {
    const user = await insertUser({ role: 'COACH' });
    const coachProfile = await db.prisma.coachProfile.create({ data: { userId: user.id, trainerId, status: 'ACTIVE', ...overrides } });
    return { userId: user.id, coachProfileId: coachProfile.id, accessToken: await signToken(user, { role: 'COACH', tid: trainerId }) };
  }

  async function insertParent() {
    const user = await insertUser({ role: 'PLAYER_PARENT' });
    return { userId: user.id, accessToken: await signToken(user) };
  }

  function insertProfile(accountUserId: string, overrides: Record<string, unknown> = {}) {
    return db.prisma.playerProfile.create({
      data: { accountUserId, name: 'Kid One', dateOfBirth: new Date('2016-01-01'), gender: 'FEMALE', isSelf: false, ...overrides },
    });
  }

  function connect(trainerId: string, playerProfileId: string, overrides: Record<string, unknown> = {}) {
    return db.prisma.playerTrainerAssociation.create({ data: { trainerId, playerProfileId, ...overrides } });
  }

  function setPlayerAvailability(playerProfileId: string) {
    return db.prisma.availability.create({
      data: { subjectType: 'PLAYER', playerProfileId, dayOfWeek: 2, startTime: 600, endTime: 660, isAvailable: true },
    });
  }

  function get(token: string) {
    return request(app.getHttpServer()).get('/dashboard/stats').set('Authorization', `Bearer ${token}`);
  }

  function metricsByKey(body: { metrics: Array<{ key: string; value: number; unit?: string; hint?: string; delta?: Record<string, unknown> }> }) {
    return Object.fromEntries(body.metrics.map((metric) => [metric.key, metric]));
  }

  it('unauthenticated -> 401', async () => {
    const res = await request(app.getHttpServer()).get('/dashboard/stats');
    expect(res.status).toBe(401);
  });

  describe('SUPER_ADMIN', () => {
    it('returns platform-wide counts, deltas and a zero-filled 30-day new-users series', async () => {
      const admin = await insertSuperAdmin();
      const trainer = await insertTrainer();
      await insertCoach(trainer.trainerId);
      await insertParent();
      await insertUser({ role: 'PLAYER_PARENT', status: 'INACTIVE' });
      await insertUser({ role: 'PLAYER_PARENT', status: 'DELETED', deletedAt: new Date() });
      // An old account, outside the 30-day window but inside the previous one.
      await insertUser({ role: 'PLAYER_PARENT', createdAt: new Date(Date.now() - 40 * DAY_MS) });
      const impersonated = await insertUser({ role: 'PLAYER_PARENT' });
      await db.prisma.impersonationLog.create({ data: { adminUserId: admin.userId, targetUserId: impersonated.id } });

      const res = await get(admin.accessToken);

      expect(res.status).toBe(200);
      expect(res.body.role).toBe('SUPER_ADMIN');
      expect(typeof res.body.generatedAt).toBe('string');
      const m = metricsByKey(res.body);
      // admin + trainer + coach + parent + inactive + old parent + impersonated (the DELETED row is excluded)
      expect(m.total_users.value).toBe(7);
      expect(m.active_trainers.value).toBe(1);
      expect(m.active_coaches.value).toBe(1);
      expect(m.active_players_parents.value).toBe(3);
      expect(m.inactive_accounts.value).toBe(2);
      expect(m.new_users_30d.value).toBe(6);
      expect(m.new_users_30d.delta).toEqual({ value: 5, period: 'month', direction: 'up' });
      expect(m.impersonation_sessions_7d).toMatchObject({ value: 1, delta: { value: 1, period: 'week', direction: 'up' } });

      const [series] = res.body.series;
      expect(series.key).toBe('new_users_daily');
      expect(series.points).toHaveLength(30);
      expect(series.points[0].date < series.points[29].date).toBe(true);
      expect(series.points.reduce((sum: number, point: { value: number }) => sum + point.value, 0)).toBe(m.new_users_30d.value);
    });
  });

  describe('TRAINER', () => {
    it('counts only the caller\'s own tenant (trainer A never sees trainer B\'s rows)', async () => {
      const a = await insertTrainer({ businessName: 'Trainer A' });
      const b = await insertTrainer({ businessName: 'Trainer B' });

      // Trainer A: 2 active players (1 with availability, 1 via share link), 1 removed, 1 active coach, 1 pending invite, 1 active player link.
      const parent = await insertParent();
      const a1 = await insertProfile(parent.userId, { name: 'A1' });
      const a2 = await insertProfile(parent.userId, { name: 'A2' });
      const aRemoved = await insertProfile(parent.userId, { name: 'A3' });
      await setPlayerAvailability(a1.id);
      const link = await db.prisma.shareLink.create({
        data: { code: randomUUID().slice(0, 12), type: 'PLAYER_STATIC', trainerId: a.trainerId, createdByUserId: a.userId },
      });
      await connect(a.trainerId, a1.id);
      await connect(a.trainerId, a2.id, { shareLinkId: link.id });
      await connect(a.trainerId, aRemoved.id, { status: 'INACTIVE', disconnectedAt: new Date() });
      const aCoach = await insertCoach(a.trainerId);
      await db.prisma.shareLink.create({
        data: {
          code: randomUUID().slice(0, 12),
          type: 'COACH_UNIQUE',
          trainerId: a.trainerId,
          createdByUserId: a.userId,
          targetEmail: 'invitee@example.com',
          expiresAt: new Date(Date.now() + DAY_MS),
          maxUses: 1,
        },
      });
      await db.prisma.coachAvailabilityOverride.create({
        data: { eventId: randomUUID(), coachId: aCoach.coachProfileId, trainerId: a.trainerId, reason: 'Sick' },
      });

      // Trainer B: lots of rows that must NOT leak into A's numbers.
      const bParent = await insertParent();
      for (let i = 0; i < 4; i += 1) {
        const profile = await insertProfile(bParent.userId, { name: `B${i}` });
        await connect(b.trainerId, profile.id);
      }
      const bCoach = await insertCoach(b.trainerId);
      await insertCoach(b.trainerId);
      await db.prisma.shareLink.create({
        data: { code: randomUUID().slice(0, 12), type: 'PLAYER_STATIC', trainerId: b.trainerId, createdByUserId: b.userId },
      });
      await db.prisma.coachAvailabilityOverride.create({
        data: { eventId: randomUUID(), coachId: bCoach.coachProfileId, trainerId: b.trainerId, reason: 'Other tenant' },
      });

      const res = await get(a.accessToken);

      expect(res.status).toBe(200);
      expect(res.body.role).toBe('TRAINER');
      const m = metricsByKey(res.body);
      expect(m.connected_players.value).toBe(2);
      expect(m.new_players_30d.value).toBe(2);
      expect(m.new_players_30d.delta).toEqual({ value: 2, period: 'month', direction: 'up' });
      expect(m.active_coaches.value).toBe(1);
      expect(m.pending_coach_invites.value).toBe(1);
      expect(m.active_share_links.value).toBe(1);
      expect(m.share_link_redemptions_30d.value).toBe(1);
      expect(m.players_with_availability_pct).toMatchObject({ value: 50, unit: 'percent' });
      expect(m.coach_overrides_30d.value).toBe(1);
      const [series] = res.body.series;
      expect(series.key).toBe('new_players_daily');
      expect(series.points).toHaveLength(30);
      expect(series.points.reduce((sum: number, point: { value: number }) => sum + point.value, 0)).toBe(2);

      // And the mirror image: B sees B's world only.
      const resB = await get(b.accessToken);
      const mB = metricsByKey(resB.body);
      expect(mB.connected_players.value).toBe(4);
      expect(mB.active_coaches.value).toBe(2);
      expect(mB.pending_coach_invites.value).toBe(0);
      expect(mB.active_share_links.value).toBe(1);
      expect(mB.share_link_redemptions_30d.value).toBe(0);
      expect(mB.players_with_availability_pct.value).toBe(0);
      expect(mB.coach_overrides_30d.value).toBe(1);
    });
  });

  describe('COACH', () => {
    it('returns weekly availability, overrides received and the employing trainer\'s name, scoped to the coach', async () => {
      const trainer = await insertTrainer({ businessName: 'Elite FC' });
      const coach = await insertCoach(trainer.trainerId);
      const otherCoach = await insertCoach(trainer.trainerId);
      await db.prisma.availability.createMany({
        data: [
          { subjectType: 'COACH', coachProfileId: coach.coachProfileId, dayOfWeek: 1, startTime: 540, endTime: 660, isAvailable: true }, // 2h
          { subjectType: 'COACH', coachProfileId: coach.coachProfileId, dayOfWeek: 3, startTime: 600, endTime: 690, isAvailable: true }, // 1.5h
          { subjectType: 'COACH', coachProfileId: coach.coachProfileId, dayOfWeek: 4, startTime: 600, endTime: 900, isAvailable: false }, // not counted
          { subjectType: 'COACH', coachProfileId: otherCoach.coachProfileId, dayOfWeek: 1, startTime: 0, endTime: 600, isAvailable: true }, // someone else
        ],
      });
      await db.prisma.coachAvailabilityOverride.create({
        data: { eventId: randomUUID(), coachId: coach.coachProfileId, trainerId: trainer.trainerId, reason: 'Event' },
      });
      await db.prisma.coachAvailabilityOverride.create({
        data: { eventId: randomUUID(), coachId: otherCoach.coachProfileId, trainerId: trainer.trainerId, reason: 'Not mine' },
      });

      const res = await get(coach.accessToken);

      expect(res.status).toBe(200);
      expect(res.body.role).toBe('COACH');
      expect(res.body.series).toBeUndefined();
      const m = metricsByKey(res.body);
      expect(m.weekly_slots.value).toBe(2);
      expect(m.weekly_hours).toMatchObject({ value: 3.5, unit: 'hours' });
      expect(m.availability_overrides_30d).toMatchObject({ value: 1, delta: { value: 1, period: 'month', direction: 'up' } });
      expect(m.team_coaches).toMatchObject({ value: 2, hint: 'At Elite FC' });
    });
  });

  describe('PLAYER_PARENT', () => {
    it('ADULT: counts self + children, distinct trainers, pending approvals and children with availability', async () => {
      const parent = await insertParent();
      const other = await insertParent();
      const t1 = await insertTrainer();
      const t2 = await insertTrainer();
      const self = await insertProfile(parent.userId, { isSelf: true, name: 'Self' });
      const kid1 = await insertProfile(parent.userId, { name: 'Kid 1' });
      const kid2 = await insertProfile(parent.userId, { name: 'Kid 2' });
      const strangerKid = await insertProfile(other.userId, { name: 'Not mine' });
      await setPlayerAvailability(kid1.id);
      await setPlayerAvailability(strangerKid.id);
      await connect(t1.trainerId, self.id);
      await connect(t1.trainerId, kid1.id);
      await connect(t2.trainerId, kid2.id);
      await connect(t2.trainerId, kid1.id, { status: 'INACTIVE', disconnectedAt: new Date() });
      await connect(t1.trainerId, strangerKid.id);
      const approval = {
        playerProfileId: kid1.id,
        parentUserId: parent.userId,
        eventId: randomUUID(),
        amount: '5.00',
        paymentType: 'USD' as const,
        expiresAt: new Date(Date.now() + DAY_MS),
      };
      await db.prisma.childPurchaseApproval.create({ data: { ...approval, status: 'PENDING' } });
      await db.prisma.childPurchaseApproval.create({ data: { ...approval, eventId: randomUUID(), status: 'APPROVED', respondedAt: new Date() } });

      const res = await get(parent.accessToken);

      expect(res.status).toBe(200);
      expect(res.body.role).toBe('PLAYER_PARENT');
      const m = metricsByKey(res.body);
      expect(m.profiles.value).toBe(3);
      expect(m.connected_trainers.value).toBe(2);
      expect(m.pending_approvals.value).toBe(1);
      expect(m.availability_set_pct).toMatchObject({ value: 50, unit: 'percent', label: 'Children with availability' });
    });

    it('CHILD: sees only its own profile and no pending_approvals metric', async () => {
      const parent = await insertParent();
      const childUser = await insertUser();
      const trainer = await insertTrainer();
      const own = await insertProfile(parent.userId, { childUserId: childUser.id, name: 'Kid' });
      await insertProfile(parent.userId, { name: 'Sibling' });
      await connect(trainer.trainerId, own.id);
      await db.prisma.childPurchaseApproval.create({
        data: { playerProfileId: own.id, parentUserId: parent.userId, eventId: randomUUID(), amount: '5.00', paymentType: 'USD', expiresAt: new Date(Date.now() + DAY_MS) },
      });
      const childToken = await signToken(childUser, { typ: 'CHILD', gid: parent.userId });

      const res = await get(childToken);

      expect(res.status).toBe(200);
      const m = metricsByKey(res.body);
      expect(m.profiles.value).toBe(1);
      expect(m.connected_trainers.value).toBe(1);
      expect(m.pending_approvals).toBeUndefined();
      expect(m.availability_set_pct.value).toBe(0);
    });
  });

  it('an impersonated session sees the TARGET role\'s dashboard, not the admin\'s', async () => {
    const admin = await insertSuperAdmin();
    const target = await insertTrainer();
    const parent = await insertParent();
    const profile = await insertProfile(parent.userId);
    await connect(target.trainerId, profile.id);

    const startRes = await request(app.getHttpServer())
      .post('/impersonation/start')
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ targetUserId: target.userId });
    expect(startRes.status).toBe(201);

    const res = await get(startRes.body.accessToken as string);

    expect(res.status).toBe(200);
    expect(res.body.role).toBe('TRAINER');
    expect(metricsByKey(res.body).connected_players.value).toBe(1);
  });
});
