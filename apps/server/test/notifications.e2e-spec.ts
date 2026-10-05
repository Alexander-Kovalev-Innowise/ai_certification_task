import { randomUUID } from 'node:crypto';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import request from 'supertest';

import { resetTestDatabase, startTestDatabase, stopTestDatabase, TestDatabase } from './setup/testcontainers.setup';

// US-01.05 (in-app half) + US-01.10 ("request change"): the derived notification
// feed for every role, its per-user read-state, and the coach change-request flow.
describe('Notifications + coach change request (e2e)', () => {
  jest.setTimeout(180_000);

  let db: TestDatabase;
  let app: INestApplication;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamically required after DATABASE_URL is set
  let jwtService: any;

  const originalDatabaseUrl = process.env.DATABASE_URL;

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

  async function insertUser(role: string, overrides: Record<string, unknown> = {}) {
    const id = randomUUID();
    return db.prisma.user.create({
      data: { id, email: `${id}@example.com`, passwordHash: 'x', role: role as never, firstName: 'First', lastName: 'Last', status: 'ACTIVE', ...overrides },
    });
  }

  function signToken(user: { id: string; role: string }, extra: Record<string, unknown> = {}): Promise<string> {
    return jwtService.signAsync(
      { sub: user.id, role: user.role, typ: 'ADULT', gid: null, tid: null, tv: 0, jti: randomUUID(), ...extra },
      { expiresIn: '15m' },
    );
  }

  async function insertTrainer() {
    const user = await insertUser('TRAINER', { firstName: 'Tina', lastName: 'Trainer' });
    const trainerId = randomUUID();
    await db.prisma.trainerProfile.create({ data: { id: trainerId, userId: user.id, businessName: 'Acme Co' } });
    return { userId: user.id, trainerId, email: user.email, accessToken: await signToken(user, { tid: trainerId }) };
  }

  async function insertCoach(trainerId: string) {
    const user = await insertUser('COACH', { firstName: 'Cara', lastName: 'Coach' });
    const coachId = randomUUID();
    await db.prisma.coachProfile.create({ data: { id: coachId, userId: user.id, trainerId, status: 'ACTIVE' } });
    return { userId: user.id, coachId, accessToken: await signToken(user, { tid: trainerId }) };
  }

  async function seedOverride(coachId: string, trainerId: string) {
    return db.prisma.coachAvailabilityOverride.create({
      data: { eventId: randomUUID(), coachId, trainerId, reason: 'Emergency cover', sessionLabel: 'Tue drill' },
    });
  }

  const feed = (token: string) => request(app.getHttpServer()).get('/me/notifications').set('Authorization', `Bearer ${token}`);
  const markRead = (token: string, itemId: string) =>
    request(app.getHttpServer()).post(`/me/notifications/${encodeURIComponent(itemId)}/read`).set('Authorization', `Bearer ${token}`);

  describe('GET /me/notifications', () => {
    it('requires authentication', async () => {
      await request(app.getHttpServer()).get('/me/notifications').expect(401);
    });

    it('a guardian sees each PENDING child approval, and it disappears once decided', async () => {
      const parent = await insertUser('PLAYER_PARENT');
      const token = await signToken(parent);
      const profile = await db.prisma.playerProfile.create({
        data: { accountUserId: parent.id, name: 'Kid One', dateOfBirth: new Date('2016-01-01'), gender: 'FEMALE' },
      });
      const approval = await db.prisma.childPurchaseApproval.create({
        data: {
          playerProfileId: profile.id,
          parentUserId: parent.id,
          title: 'Soccer ball',
          amount: '12.50',
          paymentType: 'USD',
          expiresAt: new Date(Date.now() + 48 * 3600 * 1000),
        },
      });

      const res = await feed(token).expect(200);
      expect(res.body.unreadCount).toBe(1);
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0]).toMatchObject({
        id: `approval:${approval.id}`,
        kind: 'APPROVAL_PENDING',
        href: '/approvals',
        read: false,
      });
      expect(res.body.items[0].title).toContain('Kid One');
      expect(res.body.items[0].body).toContain('Soccer ball');
      expect(res.body.items[0].body).toContain('$12.5');

      await db.prisma.childPurchaseApproval.update({ where: { id: approval.id }, data: { status: 'APPROVED', respondedAt: new Date() } });
      const after = await feed(token).expect(200);
      expect(after.body).toEqual({ unreadCount: 0, items: [] });
    });

    it('a child sees guardian questions and decisions on their own requests (/requests) and the guardian is not shown them as decisions', async () => {
      const parent = await insertUser('PLAYER_PARENT');
      const child = await insertUser('PLAYER_PARENT');
      const childToken = await signToken(child, { typ: 'CHILD', gid: parent.id });
      const profile = await db.prisma.playerProfile.create({
        data: { accountUserId: parent.id, childUserId: child.id, name: 'Kid One', dateOfBirth: new Date('2016-01-01'), gender: 'FEMALE' },
      });
      const base = { playerProfileId: profile.id, parentUserId: parent.id, amount: '5', paymentType: 'TOKEN' as const };
      const asked = await db.prisma.childPurchaseApproval.create({
        data: { ...base, title: 'Cleats', expiresAt: new Date(Date.now() + 3600_000), infoRequestMessage: 'Which size?', infoRequestedAt: new Date() },
      });
      const denied = await db.prisma.childPurchaseApproval.create({
        data: { ...base, title: 'Jersey', status: 'DENIED', respondedAt: new Date(), parentNotes: 'Not now', expiresAt: new Date(Date.now() + 3600_000) },
      });
      // Decided long ago: outside the window, so not listed.
      await db.prisma.childPurchaseApproval.create({
        data: { ...base, title: 'Old', status: 'APPROVED', respondedAt: new Date(Date.now() - 40 * 86_400_000), expiresAt: new Date(Date.now() - 39 * 86_400_000) },
      });

      const res = await feed(childToken).expect(200);
      const ids = res.body.items.map((i: { id: string }) => i.id);
      expect(res.body.items).toHaveLength(2);
      expect(ids).toContain(`child-decision:${denied.id}`);
      expect(ids.some((id: string) => id.startsWith(`child-info:${asked.id}:`))).toBe(true);
      expect(res.body.items.every((i: { href: string }) => i.href === '/requests')).toBe(true);
      expect(res.body.unreadCount).toBe(2);

      // The guardian only has the still-PENDING one awaiting an answer.
      const parentFeed = await feed(await signToken(parent)).expect(200);
      expect(parentFeed.body.items.map((i: { kind: string }) => i.kind)).toEqual(['APPROVAL_PENDING']);
    });

    it('a coach sees unresolved overrides (/my-times); a trainer sees none for them; super admin gets an empty feed', async () => {
      const trainer = await insertTrainer();
      const coach = await insertCoach(trainer.trainerId);
      const override = await seedOverride(coach.coachId, trainer.trainerId);

      const coachFeed = await feed(coach.accessToken).expect(200);
      expect(coachFeed.body.unreadCount).toBe(1);
      expect(coachFeed.body.items[0]).toMatchObject({ id: `override:${override.id}`, kind: 'OVERRIDE_NEW', href: '/my-times', read: false });

      expect((await feed(trainer.accessToken).expect(200)).body.items).toEqual([]);

      const admin = await insertUser('SUPER_ADMIN');
      expect((await feed(await signToken(admin)).expect(200)).body).toEqual({ unreadCount: 0, items: [] });
    });
  });

  describe('read state', () => {
    it('marks one item read, then all; another user is unaffected; unknown ids are 404', async () => {
      const trainer = await insertTrainer();
      const coachA = await insertCoach(trainer.trainerId);
      const coachB = await insertCoach(trainer.trainerId);
      const o1 = await seedOverride(coachA.coachId, trainer.trainerId);
      const o2 = await seedOverride(coachA.coachId, trainer.trainerId);
      await seedOverride(coachB.coachId, trainer.trainerId);

      expect((await feed(coachA.accessToken)).body.unreadCount).toBe(2);

      await markRead(coachA.accessToken, `override:${o1.id}`).expect(204);
      const afterOne = (await feed(coachA.accessToken)).body;
      expect(afterOne.unreadCount).toBe(1);
      expect(afterOne.items.find((i: { id: string }) => i.id === `override:${o1.id}`).read).toBe(true);

      // Marking twice is idempotent.
      await markRead(coachA.accessToken, `override:${o1.id}`).expect(204);
      expect(await db.prisma.notificationRead.count({ where: { userId: coachA.userId } })).toBe(1);

      await request(app.getHttpServer()).post('/me/notifications/read-all').set('Authorization', `Bearer ${coachA.accessToken}`).expect(204);
      const afterAll = (await feed(coachA.accessToken)).body;
      expect(afterAll.unreadCount).toBe(0);
      expect(afterAll.items).toHaveLength(2);
      expect(await db.prisma.notificationRead.count({ where: { userId: coachA.userId } })).toBe(2);

      // Coach B still has its own unread item and cannot mark coach A's item.
      expect((await feed(coachB.accessToken)).body.unreadCount).toBe(1);
      await markRead(coachB.accessToken, `override:${o2.id}`).expect(404);
      await markRead(coachB.accessToken, 'does-not-exist').expect(404);
      expect(await db.prisma.notificationRead.count({ where: { userId: coachB.userId } })).toBe(0);
    });
  });

  describe('POST /coaches/:id/availability/overrides/:oid/request-change', () => {
    const url = (coachId: string, overrideId: string) => `/coaches/${coachId}/availability/overrides/${overrideId}/request-change`;

    it('stores the request, emails the trainer, notifies the trainer and badges the roster', async () => {
      const trainer = await insertTrainer();
      const coach = await insertCoach(trainer.trainerId);
      const override = await seedOverride(coach.coachId, trainer.trainerId);

      await request(app.getHttpServer())
        .post(url(coach.coachId, override.id))
        .set('Authorization', `Bearer ${coach.accessToken}`)
        .send({ message: '  Can we move it to Wednesday?  ' })
        .expect(204);

      const row = await db.prisma.coachAvailabilityOverride.findUniqueOrThrow({ where: { id: override.id } });
      expect(row.changeRequestedAt).not.toBeNull();
      expect(row.changeRequestMessage).toBe('Can we move it to Wednesday?');
      expect(row.acknowledgedAt).toBeNull();

      const jobs = await db.prisma.outboxJob.findMany({ where: { type: 'EMAIL_COACH_CHANGE_REQUEST' } });
      expect(jobs).toHaveLength(1);
      expect(jobs[0].payload).toMatchObject({
        to: trainer.email,
        templateData: { coachName: 'Cara Coach', message: 'Can we move it to Wednesday?', sessionLabel: 'Tue drill' },
      });

      // The coach's own override list reports the status.
      const list = await request(app.getHttpServer())
        .get(`/coaches/${coach.coachId}/availability/overrides`)
        .set('Authorization', `Bearer ${coach.accessToken}`)
        .expect(200);
      expect(list.body[0]).toMatchObject({ changeRequestMessage: 'Can we move it to Wednesday?', acknowledgedAt: null });
      expect(list.body[0].changeRequestedAt).toBeTruthy();

      // Trainer: in-app notification linking to /coaches.
      const trainerFeed = (await feed(trainer.accessToken).expect(200)).body;
      expect(trainerFeed.unreadCount).toBe(1);
      expect(trainerFeed.items[0]).toMatchObject({ kind: 'OVERRIDE_CHANGE_REQUESTED', href: '/coaches' });
      expect(trainerFeed.items[0].title).toContain('Cara Coach');
      expect(trainerFeed.items[0].body).toContain('Wednesday');

      // The coach no longer has a "new override" notification (they responded).
      expect((await feed(coach.accessToken).expect(200)).body.items).toEqual([]);

      // Trainer roster: badge data on the coach row.
      const roster = await request(app.getHttpServer())
        .get(`/trainers/${trainer.trainerId}/coaches`)
        .set('Authorization', `Bearer ${trainer.accessToken}`)
        .expect(200);
      const coachRow = roster.body.items.find((r: { id: string }) => r.id === coach.coachId);
      expect(coachRow.changeRequest).toMatchObject({ overrideId: override.id, message: 'Can we move it to Wednesday?', sessionLabel: 'Tue drill' });
    });

    it('a re-sent request is a fresh unread notification; accepting afterwards clears it and tells the trainer', async () => {
      const trainer = await insertTrainer();
      const coach = await insertCoach(trainer.trainerId);
      const override = await seedOverride(coach.coachId, trainer.trainerId);
      const send = (message: string) =>
        request(app.getHttpServer()).post(url(coach.coachId, override.id)).set('Authorization', `Bearer ${coach.accessToken}`).send({ message });

      await send('First request').expect(204);
      await request(app.getHttpServer()).post('/me/notifications/read-all').set('Authorization', `Bearer ${trainer.accessToken}`).expect(204);
      expect((await feed(trainer.accessToken)).body.unreadCount).toBe(0);

      await new Promise((resolve) => setTimeout(resolve, 15));
      await send('Second request').expect(204);
      const again = (await feed(trainer.accessToken)).body;
      expect(again.items).toHaveLength(1);
      expect(again.unreadCount).toBe(1);
      expect(again.items[0].body).toContain('Second request');

      await request(app.getHttpServer())
        .post(`/coaches/${coach.coachId}/availability/overrides/${override.id}/acknowledge`)
        .set('Authorization', `Bearer ${coach.accessToken}`)
        .expect(204);
      const accepted = (await feed(trainer.accessToken)).body;
      expect(accepted.items.map((i: { kind: string }) => i.kind)).toEqual(['OVERRIDE_ACCEPTED']);

      // Once accepted a change can no longer be requested.
      const res = await send('Too late please').expect(409);
      expect(res.body.errorCode).toBe('OVERRIDE_ALREADY_ACKNOWLEDGED');

      const roster = await request(app.getHttpServer())
        .get(`/trainers/${trainer.trainerId}/coaches`)
        .set('Authorization', `Bearer ${trainer.accessToken}`)
        .expect(200);
      expect(roster.body.items.find((r: { id: string }) => r.id === coach.coachId).changeRequest).toBeNull();
    });

    it('validates the message length (5-500) -> 400', async () => {
      const trainer = await insertTrainer();
      const coach = await insertCoach(trainer.trainerId);
      const override = await seedOverride(coach.coachId, trainer.trainerId);
      for (const message of ['', 'abcd', '    ', 'x'.repeat(501)]) {
        const res = await request(app.getHttpServer())
          .post(url(coach.coachId, override.id))
          .set('Authorization', `Bearer ${coach.accessToken}`)
          .send({ message });
        expect(res.status).toBe(400);
      }
      await request(app.getHttpServer())
        .post(url(coach.coachId, override.id))
        .set('Authorization', `Bearer ${coach.accessToken}`)
        .send({ message: 'x'.repeat(500) })
        .expect(204);
    });

    it('only the owning coach may request a change: other coach 404, trainer 403; unknown override 404', async () => {
      const trainer = await insertTrainer();
      const coach = await insertCoach(trainer.trainerId);
      const other = await insertCoach(trainer.trainerId);
      const override = await seedOverride(coach.coachId, trainer.trainerId);
      const body = { message: 'Please change this' };

      await request(app.getHttpServer()).post(url(coach.coachId, override.id)).set('Authorization', `Bearer ${other.accessToken}`).send(body).expect(404);
      await request(app.getHttpServer()).post(url(coach.coachId, override.id)).set('Authorization', `Bearer ${trainer.accessToken}`).send(body).expect(403);
      await request(app.getHttpServer()).post(url(coach.coachId, randomUUID())).set('Authorization', `Bearer ${coach.accessToken}`).send(body).expect(404);
      await request(app.getHttpServer()).post(url(coach.coachId, override.id)).send(body).expect(401);
      expect((await db.prisma.coachAvailabilityOverride.findUniqueOrThrow({ where: { id: override.id } })).changeRequestedAt).toBeNull();
    });
  });
});
