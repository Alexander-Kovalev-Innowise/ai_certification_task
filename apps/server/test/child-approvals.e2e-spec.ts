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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let approvalExpiryJob: any;

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

    /* eslint-disable @typescript-eslint/no-require-imports -- deliberate, defers evaluation until after DATABASE_URL is set */
    const { ApprovalExpiryJob } = require('../src/modules/child-approvals/approval-expiry.job') as typeof import('../src/modules/child-approvals/approval-expiry.job');
    /* eslint-enable @typescript-eslint/no-require-imports */
    approvalExpiryJob = moduleRef.get(ApprovalExpiryJob);
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

  describe('POST /approvals/:id/approve (Task 5.13)', () => {
    it('approves a PENDING request -> 200', async () => {
      const parent = await insertParent();
      const profile = await insertProfile(parent.userId);
      const approval = await insertApproval(profile.id, parent.userId);

      const res = await request(app.getHttpServer())
        .post(`/approvals/${approval.id}/approve`)
        .set('Authorization', `Bearer ${parent.accessToken}`)
        .send({ notes: 'Sure, go ahead' });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: 'APPROVED', parentNotes: 'Sure, go ahead' });

      const row = await db.prisma.childPurchaseApproval.findUnique({ where: { id: approval.id } });
      expect(row?.status).toBe('APPROVED');
      expect(row?.respondedAt).not.toBeNull();
    });

    it('not the caller\'s child -> 404', async () => {
      const owner = await insertParent();
      const stranger = await insertParent();
      const profile = await insertProfile(owner.userId);
      const approval = await insertApproval(profile.id, owner.userId);

      const res = await request(app.getHttpServer())
        .post(`/approvals/${approval.id}/approve`)
        .set('Authorization', `Bearer ${stranger.accessToken}`)
        .send({});

      expect(res.status).toBe(404);
    });

    it('a CHILD token -> 403 CHILD_CAPABILITY_DENIED', async () => {
      const parent = await insertParent();
      const childUser = await insertUser({ role: 'PLAYER_PARENT' });
      const profile = await insertProfile(parent.userId, { childUserId: childUser.id });
      const approval = await insertApproval(profile.id, parent.userId);
      const childToken = await signToken(childUser, { typ: 'CHILD', gid: parent.userId });

      const res = await request(app.getHttpServer())
        .post(`/approvals/${approval.id}/approve`)
        .set('Authorization', `Bearer ${childToken}`)
        .send({});

      expect(res.status).toBe(403);
      expect(res.body.errorCode).toBe('CHILD_CAPABILITY_DENIED');
    });

    it('approving an already-resolved request -> 409 CONFLICT, no double-transition', async () => {
      const parent = await insertParent();
      const profile = await insertProfile(parent.userId);
      const approval = await insertApproval(profile.id, parent.userId, { status: 'DENIED', respondedAt: new Date() });

      const res = await request(app.getHttpServer())
        .post(`/approvals/${approval.id}/approve`)
        .set('Authorization', `Bearer ${parent.accessToken}`)
        .send({});

      expect(res.status).toBe(409);
      expect(res.body.errorCode).toBe('CONFLICT');

      const row = await db.prisma.childPurchaseApproval.findUnique({ where: { id: approval.id } });
      expect(row?.status).toBe('DENIED');
    });

    it('race-critical: approving a row the expiry sweep has just expired -> 409 CONFLICT, never a double-transition', async () => {
      const parent = await insertParent();
      const profile = await insertProfile(parent.userId);
      const approval = await insertApproval(profile.id, parent.userId, { expiresAt: new Date(Date.now() - 1_000) });

      // Simulates the sweep winning the race first.
      await approvalExpiryJob.sweep();

      const res = await request(app.getHttpServer())
        .post(`/approvals/${approval.id}/approve`)
        .set('Authorization', `Bearer ${parent.accessToken}`)
        .send({});

      expect(res.status).toBe(409);
      expect(res.body.errorCode).toBe('CONFLICT');

      const row = await db.prisma.childPurchaseApproval.findUnique({ where: { id: approval.id } });
      expect(row?.status).toBe('EXPIRED');
    });
  });

  describe('POST /approvals/:id/deny (Task 5.13)', () => {
    it('denies a PENDING request -> 200, notifies the child via email', async () => {
      const parent = await insertParent();
      const childUser = await insertUser({ role: 'PLAYER_PARENT' });
      const profile = await insertProfile(parent.userId, { childUserId: childUser.id });
      const approval = await insertApproval(profile.id, parent.userId);

      const res = await request(app.getHttpServer())
        .post(`/approvals/${approval.id}/deny`)
        .set('Authorization', `Bearer ${parent.accessToken}`)
        .send({ notes: 'Not this time' });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('DENIED');

      const jobs = await db.prisma.outboxJob.findMany({ where: { type: 'EMAIL_CHILD_APPROVAL_DECISION' } });
      expect(jobs).toHaveLength(1);
      expect(jobs[0].payload).toMatchObject({ to: childUser.email });
    });

    it('falls back to notifying the guardian when the profile has no separate child login', async () => {
      const parent = await insertParent();
      const parentUser = await db.prisma.user.findUniqueOrThrow({ where: { id: parent.userId } });
      const profile = await insertProfile(parent.userId);
      const approval = await insertApproval(profile.id, parent.userId);

      const res = await request(app.getHttpServer())
        .post(`/approvals/${approval.id}/deny`)
        .set('Authorization', `Bearer ${parent.accessToken}`)
        .send({});

      expect(res.status).toBe(200);

      const jobs = await db.prisma.outboxJob.findMany({ where: { type: 'EMAIL_CHILD_APPROVAL_DECISION' } });
      expect(jobs).toHaveLength(1);
      expect(jobs[0].payload).toMatchObject({ to: parentUser.email });
    });

    it('denying an already-resolved request -> 409 CONFLICT', async () => {
      const parent = await insertParent();
      const profile = await insertProfile(parent.userId);
      const approval = await insertApproval(profile.id, parent.userId, { status: 'APPROVED', respondedAt: new Date() });

      const res = await request(app.getHttpServer())
        .post(`/approvals/${approval.id}/deny`)
        .set('Authorization', `Bearer ${parent.accessToken}`)
        .send({});

      expect(res.status).toBe(409);
    });
  });

  describe('ApprovalExpiryJob sweep (Task 5.13)', () => {
    it('flips only PENDING rows past their expiresAt, notifying both parties', async () => {
      const parent = await insertParent();
      const childUser = await insertUser({ role: 'PLAYER_PARENT' });
      const profile = await insertProfile(parent.userId, { childUserId: childUser.id });

      const pastDue = await insertApproval(profile.id, parent.userId, { expiresAt: new Date(Date.now() - 1_000) });
      const notYetDue = await insertApproval(profile.id, parent.userId, { expiresAt: new Date(Date.now() + 60_000) });
      const alreadyResolved = await insertApproval(profile.id, parent.userId, {
        status: 'APPROVED',
        respondedAt: new Date(),
        expiresAt: new Date(Date.now() - 1_000),
      });

      await approvalExpiryJob.sweep();

      const rows = await db.prisma.childPurchaseApproval.findMany({ where: { id: { in: [pastDue.id, notYetDue.id, alreadyResolved.id] } } });
      const byId = new Map(rows.map((r: { id: string; status: string }) => [r.id, r.status]));
      expect(byId.get(pastDue.id)).toBe('EXPIRED');
      expect(byId.get(notYetDue.id)).toBe('PENDING');
      expect(byId.get(alreadyResolved.id)).toBe('APPROVED');

      const jobs = await db.prisma.outboxJob.findMany({ where: { type: 'EMAIL_CHILD_APPROVAL_DECISION' } });
      const recipients = jobs.map((j: { payload: unknown }) => (j.payload as { to: string }).to).sort();
      expect(recipients).toEqual([childUser.email, (await db.prisma.user.findUniqueOrThrow({ where: { id: parent.userId } })).email].sort());
    });

    it('is idempotent/re-entrant — a second sweep run does not re-notify an already-EXPIRED row', async () => {
      const parent = await insertParent();
      const profile = await insertProfile(parent.userId);
      await insertApproval(profile.id, parent.userId, { expiresAt: new Date(Date.now() - 1_000) });

      await approvalExpiryJob.sweep();
      await approvalExpiryJob.sweep();

      const jobs = await db.prisma.outboxJob.findMany({ where: { type: 'EMAIL_CHILD_APPROVAL_DECISION' } });
      // One round of notifications (one recipient — no separate child login), not two.
      expect(jobs).toHaveLength(1);
    });
  });
});
