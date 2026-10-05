import { randomUUID } from 'node:crypto';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import request from 'supertest';

import { resetTestDatabase, startTestDatabase, stopTestDatabase, TestDatabase } from './setup/testcontainers.setup';

// Epic-01 gap-fill: a guardian creating the child's own login
// (POST /player-profiles/:id/child-login) and the child-initiated purchase
// approval flow (POST/GET /me/purchase-requests, approve / deny /
// request-info with child notifications).
describe('Child login + child purchase requests (e2e)', () => {
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
        firstName: 'Pat',
        lastName: 'Parent',
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

  async function insertParent(): Promise<{ id: string; email: string; accessToken: string }> {
    const user = await insertUser({ role: 'PLAYER_PARENT' });
    return { ...user, accessToken: await signToken(user) };
  }

  function insertChildProfile(accountUserId: string, overrides: Record<string, unknown> = {}) {
    return db.prisma.playerProfile.create({
      data: { accountUserId, name: 'Kid One', dateOfBirth: new Date('2016-01-01'), gender: 'FEMALE', isSelf: false, ...overrides },
    });
  }

  /** Parent + child profile that already has its own login; returns tokens for both. */
  async function seedFamily(profileOverrides: Record<string, unknown> = {}) {
    const parent = await insertParent();
    const childUser = await insertUser({ role: 'PLAYER_PARENT', firstName: 'Kid', lastName: 'One' });
    const profile = await insertChildProfile(parent.id, { childUserId: childUser.id, ...profileOverrides });
    const childToken = await signToken(childUser, { typ: 'CHILD', gid: parent.id });
    return { parent, childUser, profile, childToken };
  }

  describe('POST /player-profiles/:id/child-login', () => {
    it('creates a CHILD account linked to the profile; the child can sign in as typ CHILD', async () => {
      const parent = await insertParent();
      const profile = await insertChildProfile(parent.id);
      const email = `${randomUUID()}@example.com`;

      const res = await request(app.getHttpServer())
        .post(`/player-profiles/${profile.id}/child-login`)
        .set('Authorization', `Bearer ${parent.accessToken}`)
        .send({ email, password: 'ChildPass1' });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ playerProfileId: profile.id, email });

      const user = await db.prisma.user.findUniqueOrThrow({ where: { email } });
      expect(user).toMatchObject({ role: 'PLAYER_PARENT', status: 'ACTIVE', mustChangePassword: false, firstName: 'Kid', lastName: 'One' });
      const refreshed = await db.prisma.playerProfile.findUniqueOrThrow({ where: { id: profile.id } });
      expect(refreshed.childUserId).toBe(user.id);

      const login = await request(app.getHttpServer()).post('/auth/login').send({ email, password: 'ChildPass1' });
      expect(login.status).toBe(200);
      expect(login.body.user).toMatchObject({ accountType: 'CHILD', mustChangePassword: false });
    });

    it('duplicate email -> 409 CONFLICT, nothing linked', async () => {
      const parent = await insertParent();
      const profile = await insertChildProfile(parent.id);
      const taken = await insertUser();

      const res = await request(app.getHttpServer())
        .post(`/player-profiles/${profile.id}/child-login`)
        .set('Authorization', `Bearer ${parent.accessToken}`)
        .send({ email: taken.email, password: 'ChildPass1' });

      expect(res.status).toBe(409);
      expect(res.body.errorCode).toBe('CONFLICT');
      expect((await db.prisma.playerProfile.findUniqueOrThrow({ where: { id: profile.id } })).childUserId).toBeNull();
    });

    it('a profile that already has a login -> 409', async () => {
      const family = await seedFamily();

      const res = await request(app.getHttpServer())
        .post(`/player-profiles/${family.profile.id}/child-login`)
        .set('Authorization', `Bearer ${family.parent.accessToken}`)
        .send({ email: `${randomUUID()}@example.com`, password: 'ChildPass1' });

      expect(res.status).toBe(409);
    });

    it("the parent's own (isSelf) profile -> 400", async () => {
      const parent = await insertParent();
      const self = await insertChildProfile(parent.id, { isSelf: true, name: 'Pat Parent', dateOfBirth: new Date('1985-01-01') });

      const res = await request(app.getHttpServer())
        .post(`/player-profiles/${self.id}/child-login`)
        .set('Authorization', `Bearer ${parent.accessToken}`)
        .send({ email: `${randomUUID()}@example.com`, password: 'ChildPass1' });

      expect(res.status).toBe(400);
    });

    it("another parent's profile -> 404", async () => {
      const parent = await insertParent();
      const stranger = await insertParent();
      const profile = await insertChildProfile(parent.id);

      const res = await request(app.getHttpServer())
        .post(`/player-profiles/${profile.id}/child-login`)
        .set('Authorization', `Bearer ${stranger.accessToken}`)
        .send({ email: `${randomUUID()}@example.com`, password: 'ChildPass1' });

      expect(res.status).toBe(404);
    });

    it('weak password -> 400; a CHILD token -> 403 CHILD_CAPABILITY_DENIED', async () => {
      const family = await seedFamily();
      const sibling = await insertChildProfile(family.parent.id, { name: 'Sib' });

      const weak = await request(app.getHttpServer())
        .post(`/player-profiles/${sibling.id}/child-login`)
        .set('Authorization', `Bearer ${family.parent.accessToken}`)
        .send({ email: `${randomUUID()}@example.com`, password: 'short' });
      expect(weak.status).toBe(400);

      const asChild = await request(app.getHttpServer())
        .post(`/player-profiles/${sibling.id}/child-login`)
        .set('Authorization', `Bearer ${family.childToken}`)
        .send({ email: `${randomUUID()}@example.com`, password: 'ChildPass1' });
      expect(asChild.status).toBe(403);
      expect(asChild.body.errorCode).toBe('CHILD_CAPABILITY_DENIED');
    });
  });

  describe('POST /player-profiles/:id/child-login/reset-password', () => {
    it("the guardian sets a new password for the child's login", async () => {
      const parent = await insertParent();
      const profile = await insertChildProfile(parent.id);
      const email = `${randomUUID()}@example.com`;
      await request(app.getHttpServer())
        .post(`/player-profiles/${profile.id}/child-login`)
        .set('Authorization', `Bearer ${parent.accessToken}`)
        .send({ email, password: 'ChildPass1' })
        .expect(201);

      const res = await request(app.getHttpServer())
        .post(`/player-profiles/${profile.id}/child-login/reset-password`)
        .set('Authorization', `Bearer ${parent.accessToken}`)
        .send({ password: 'NewChildPass2' });
      expect(res.status).toBe(200);

      const oldLogin = await request(app.getHttpServer()).post('/auth/login').send({ email, password: 'ChildPass1' });
      expect(oldLogin.status).toBe(401);
      const newLogin = await request(app.getHttpServer()).post('/auth/login').send({ email, password: 'NewChildPass2' });
      expect(newLogin.status).toBe(200);
    });

    it('a profile without a login -> 404; another parent -> 404', async () => {
      const parent = await insertParent();
      const stranger = await insertParent();
      const profile = await insertChildProfile(parent.id);

      const none = await request(app.getHttpServer())
        .post(`/player-profiles/${profile.id}/child-login/reset-password`)
        .set('Authorization', `Bearer ${parent.accessToken}`)
        .send({ password: 'NewChildPass2' });
      expect(none.status).toBe(404);

      const family = await seedFamily();
      const other = await request(app.getHttpServer())
        .post(`/player-profiles/${family.profile.id}/child-login/reset-password`)
        .set('Authorization', `Bearer ${stranger.accessToken}`)
        .send({ password: 'NewChildPass2' });
      expect(other.status).toBe(404);
    });
  });

  describe('POST /me/purchase-requests', () => {
    const body = { title: 'Soccer camp', amountCents: 2500, currency: 'USD', paymentType: 'USD' };

    it('USD -> PENDING with ~48h expiry, emails the guardian', async () => {
      const family = await seedFamily();

      const res = await request(app.getHttpServer())
        .post('/me/purchase-requests')
        .set('Authorization', `Bearer ${family.childToken}`)
        .send(body);

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ status: 'PENDING', title: 'Soccer camp', amount: '25', paymentType: 'USD', playerName: 'Kid One' });
      const expiresInMs = new Date(res.body.expiresAt).getTime() - Date.now();
      expect(expiresInMs).toBeGreaterThan(47 * 3600_000);
      expect(expiresInMs).toBeLessThan(49 * 3600_000);

      const jobs = await db.prisma.outboxJob.findMany({ where: { type: 'EMAIL_CHILD_APPROVAL_REQUEST' } });
      expect(jobs).toHaveLength(1);
      expect(jobs[0].payload).toMatchObject({ to: family.parent.email });
    });

    it('TOKENS with allowChildTokenSpendWithoutApproval ON -> APPROVED immediately + informational email to the guardian', async () => {
      const family = await seedFamily({ allowChildTokenSpendWithoutApproval: true });

      const res = await request(app.getHttpServer())
        .post('/me/purchase-requests')
        .set('Authorization', `Bearer ${family.childToken}`)
        .send({ ...body, currency: 'TOKENS', paymentType: 'TOKENS', amountCents: 300 });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ status: 'APPROVED', paymentType: 'TOKEN' });
      expect(res.body.respondedAt).toEqual(expect.any(String));

      expect(await db.prisma.outboxJob.count({ where: { type: 'EMAIL_CHILD_APPROVAL_REQUEST' } })).toBe(0);
      const jobs = await db.prisma.outboxJob.findMany({ where: { type: 'EMAIL_CHILD_APPROVAL_DECISION' } });
      expect(jobs).toHaveLength(1);
      expect(jobs[0].payload).toMatchObject({ to: family.parent.email });
    });

    it('TOKENS with the flag OFF -> PENDING like USD', async () => {
      const family = await seedFamily();

      const res = await request(app.getHttpServer())
        .post('/me/purchase-requests')
        .set('Authorization', `Bearer ${family.childToken}`)
        .send({ ...body, currency: 'TOKENS', paymentType: 'TOKENS' });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('PENDING');
    });

    it('an ADULT token -> 403; invalid body -> 400', async () => {
      const family = await seedFamily();

      const adult = await request(app.getHttpServer())
        .post('/me/purchase-requests')
        .set('Authorization', `Bearer ${family.parent.accessToken}`)
        .send(body);
      expect(adult.status).toBe(403);

      const invalid = await request(app.getHttpServer())
        .post('/me/purchase-requests')
        .set('Authorization', `Bearer ${family.childToken}`)
        .send({ ...body, amountCents: 0 });
      expect(invalid.status).toBe(400);
    });
  });

  describe('GET /me/purchase-requests', () => {
    it("lists only the child's own requests with their status", async () => {
      const family = await seedFamily();
      const sibling = await insertChildProfile(family.parent.id, { name: 'Sib' });
      await db.prisma.childPurchaseApproval.create({
        data: { playerProfileId: sibling.id, parentUserId: family.parent.id, amount: '5.00', paymentType: 'USD', expiresAt: new Date(Date.now() + 3600_000) },
      });
      await request(app.getHttpServer())
        .post('/me/purchase-requests')
        .set('Authorization', `Bearer ${family.childToken}`)
        .send({ title: 'Mine', amountCents: 1000, currency: 'USD', paymentType: 'USD' })
        .expect(201);

      const res = await request(app.getHttpServer()).get('/me/purchase-requests').set('Authorization', `Bearer ${family.childToken}`);

      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0]).toMatchObject({ title: 'Mine', status: 'PENDING' });

      const adult = await request(app.getHttpServer()).get('/me/purchase-requests').set('Authorization', `Bearer ${family.parent.accessToken}`);
      expect(adult.status).toBe(403);
    });
  });

  describe('guardian decisions notify the child', () => {
    async function createRequest(family: Awaited<ReturnType<typeof seedFamily>>): Promise<string> {
      const res = await request(app.getHttpServer())
        .post('/me/purchase-requests')
        .set('Authorization', `Bearer ${family.childToken}`)
        .send({ title: 'Boots', amountCents: 4000, currency: 'USD', paymentType: 'USD' })
        .expect(201);
      await db.prisma.outboxJob.deleteMany();
      return res.body.id as string;
    }

    it('approve emails the child', async () => {
      const family = await seedFamily();
      const id = await createRequest(family);

      const res = await request(app.getHttpServer())
        .post(`/approvals/${id}/approve`)
        .set('Authorization', `Bearer ${family.parent.accessToken}`)
        .send({});

      expect(res.status).toBe(200);
      const jobs = await db.prisma.outboxJob.findMany({ where: { type: 'EMAIL_CHILD_APPROVAL_DECISION' } });
      expect(jobs).toHaveLength(1);
      expect(jobs[0].payload).toMatchObject({ to: family.childUser.email, templateData: { decision: 'APPROVED' } });
    });

    it('request-info keeps the request PENDING, records the message and emails the child', async () => {
      const family = await seedFamily();
      const id = await createRequest(family);

      const res = await request(app.getHttpServer())
        .post(`/approvals/${id}/request-info`)
        .set('Authorization', `Bearer ${family.parent.accessToken}`)
        .send({ message: 'What are the boots for?' });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: 'PENDING', infoRequestMessage: 'What are the boots for?' });
      expect(res.body.infoRequestedAt).toEqual(expect.any(String));

      const jobs = await db.prisma.outboxJob.findMany({ where: { type: 'EMAIL_CHILD_APPROVAL_DECISION' } });
      expect(jobs).toHaveLength(1);
      expect(jobs[0].payload).toMatchObject({ to: family.childUser.email, templateData: { decision: 'INFO_REQUESTED' } });

      // still decidable afterwards
      await request(app.getHttpServer())
        .post(`/approvals/${id}/deny`)
        .set('Authorization', `Bearer ${family.parent.accessToken}`)
        .send({})
        .expect(200);
    });

    it('request-info on a resolved request -> 409; by a stranger -> 404; by the child -> 403; empty message -> 400', async () => {
      const family = await seedFamily();
      const stranger = await insertParent();
      const id = await createRequest(family);

      const strangerRes = await request(app.getHttpServer())
        .post(`/approvals/${id}/request-info`)
        .set('Authorization', `Bearer ${stranger.accessToken}`)
        .send({ message: 'hi' });
      expect(strangerRes.status).toBe(404);

      const childRes = await request(app.getHttpServer())
        .post(`/approvals/${id}/request-info`)
        .set('Authorization', `Bearer ${family.childToken}`)
        .send({ message: 'hi' });
      expect(childRes.status).toBe(403);
      expect(childRes.body.errorCode).toBe('CHILD_CAPABILITY_DENIED');

      const empty = await request(app.getHttpServer())
        .post(`/approvals/${id}/request-info`)
        .set('Authorization', `Bearer ${family.parent.accessToken}`)
        .send({ message: '' });
      expect(empty.status).toBe(400);

      await request(app.getHttpServer())
        .post(`/approvals/${id}/approve`)
        .set('Authorization', `Bearer ${family.parent.accessToken}`)
        .send({})
        .expect(200);
      const resolved = await request(app.getHttpServer())
        .post(`/approvals/${id}/request-info`)
        .set('Authorization', `Bearer ${family.parent.accessToken}`)
        .send({ message: 'too late' });
      expect(resolved.status).toBe(409);
    });
  });
});
