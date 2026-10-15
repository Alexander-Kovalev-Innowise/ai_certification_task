import { randomUUID } from 'node:crypto';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import request from 'supertest';

import { resetTestDatabase, startTestDatabase, stopTestDatabase, TestDatabase } from './setup/testcontainers.setup';

// Camp/evaluation sign-up -> account conversion (Epic-01 seam for the Epic-08 camp form).
// Own file/app instance: the public routes carry `@Throttle({'auth-ip':{}})` (20 / 15 min / IP, one in-memory
// ThrottlerStorage per app), same reasoning share-links-redeem-matrix.e2e-spec.ts documents.
describe('CampConversionsController (e2e) - camp sign-up to account conversion', () => {
  jest.setTimeout(180_000);

  let db: TestDatabase;
  let app: INestApplication;

  const originalDatabaseUrl = process.env.DATABASE_URL;
  const PASSWORD = 'CorrectHorseBattery1';

  beforeAll(async () => {
    db = await startTestDatabase();
    process.env.DATABASE_URL = db.connectionUri;

    /* eslint-disable @typescript-eslint/no-require-imports -- deliberate, defers evaluation until after DATABASE_URL is set */
    const { AppModule } = require('../src/app.module') as typeof import('../src/app.module');
    const { GlobalExceptionFilter } = require('../src/shared/http/global-exception.filter') as typeof import('../src/shared/http/global-exception.filter');
    /* eslint-enable @typescript-eslint/no-require-imports */

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(helmet());
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    await stopTestDatabase(db);
    process.env.DATABASE_URL = originalDatabaseUrl;
  });

  afterEach(async () => {
    await resetTestDatabase(db);
  });

  async function seedLink(
    type: 'PLAYER_STATIC' | 'COACH_UNIQUE' = 'PLAYER_STATIC',
    overrides: Record<string, unknown> = {},
  ): Promise<{ code: string; trainerId: string }> {
    const userId = randomUUID();
    await db.prisma.user.create({
      data: {
        id: userId,
        email: `${userId}@example.com`,
        passwordHash: await argon2.hash(PASSWORD),
        role: 'TRAINER',
        firstName: 'T',
        lastName: 'R',
        status: 'ACTIVE',
      },
    });
    const trainer = await db.prisma.trainerProfile.create({ data: { userId, businessName: 'Camp Co', primaryColorHex: '#112233' } });
    const link = await db.prisma.shareLink.create({
      data: {
        code: `camp-${randomUUID()}`,
        type,
        trainerId: trainer.id,
        createdByUserId: userId,
        ...(type === 'COACH_UNIQUE' ? { targetEmail: 'c@example.com', expiresAt: new Date(Date.now() + 60_000) } : {}),
        ...overrides,
      },
    });
    return { code: link.code, trainerId: trainer.id };
  }

  function campBody(code: string, overrides: Record<string, unknown> = {}) {
    return {
      shareLinkCode: code,
      parentFirstName: 'Pat',
      parentLastName: 'Camper',
      email: `${randomUUID()}@example.com`,
      phone: '+14155552671',
      playerName: 'Kid Camper',
      playerAge: 10,
      playerGender: 'FEMALE',
      source: 'CAMP',
      submissionRef: 'sub-1',
      ...overrides,
    };
  }

  async function createConversion(code: string, overrides: Record<string, unknown> = {}) {
    const body = campBody(code, overrides);
    const res = await request(app.getHttpServer()).post('/camp-conversions').send(body);
    expect(res.status).toBe(201);
    return { body, token: res.body.conversionToken as string, res };
  }

  describe('POST /camp-conversions', () => {
    it('stores a hashed-token row and returns {conversionToken, expiresAt, joinUrl} (raw token only in the response)', async () => {
      const link = await seedLink();
      const { token, res } = await createConversion(link.code);

      expect(res.body.joinUrl).toBe(`/join/${link.code}?camp=${token}`);
      const msLeft = new Date(res.body.expiresAt as string).getTime() - Date.now();
      expect(msLeft).toBeGreaterThan(6.9 * 24 * 3600_000);
      expect(msLeft).toBeLessThanOrEqual(7 * 24 * 3600_000);

      const rows = await db.prisma.campConversion.findMany();
      expect(rows).toHaveLength(1);
      expect(rows[0].tokenHash).not.toBe(token);
      expect(JSON.stringify(rows[0])).not.toContain(token);
      expect(rows[0].usedAt).toBeNull();
    });

    it('unknown code and a COACH_UNIQUE code -> 404; revoked link -> 409; invalid body -> 400', async () => {
      const coachLink = await seedLink('COACH_UNIQUE');
      const revoked = await seedLink('PLAYER_STATIC', { status: 'REVOKED' });
      const ok = await seedLink();

      expect((await request(app.getHttpServer()).post('/camp-conversions').send(campBody('nope'))).status).toBe(404);
      expect((await request(app.getHttpServer()).post('/camp-conversions').send(campBody(coachLink.code))).status).toBe(404);
      const revokedRes = await request(app.getHttpServer()).post('/camp-conversions').send(campBody(revoked.code));
      expect(revokedRes.status).toBe(409);
      expect(revokedRes.body.errorCode).toBe('SHARE_LINK_UNAVAILABLE');
      expect((await request(app.getHttpServer()).post('/camp-conversions').send(campBody(ok.code, { playerAge: 120 }))).status).toBe(400);
      expect((await request(app.getHttpServer()).post('/camp-conversions').send(campBody(ok.code, { email: 'nope' }))).status).toBe(400);
    });
  });

  describe('GET /camp-conversions/:token', () => {
    it('returns the prefill payload and trainer branding (child => isSelf false, age-consistent dateOfBirth)', async () => {
      const link = await seedLink();
      const { token, body } = await createConversion(link.code);

      const res = await request(app.getHttpServer()).get(`/camp-conversions/${token}`);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        shareLinkCode: link.code,
        source: 'CAMP',
        trainer: { displayName: 'Camp Co', primaryColorHex: '#112233' },
        prefill: {
          parentFirstName: 'Pat',
          parentLastName: 'Camper',
          email: body.email,
          phone: body.phone,
          playerName: 'Kid Camper',
          playerAge: 10,
          gender: 'FEMALE',
          isSelf: false,
        },
      });
      const dob = new Date(res.body.prefill.dateOfBirth as string);
      const years = (Date.now() - dob.getTime()) / (365.25 * 24 * 3600_000);
      expect(Math.floor(years)).toBe(10);
      expect(res.body.prefill.password).toBeUndefined();
    });

    it('unknown token -> 404; expired token -> 410 TOKEN_EXPIRED', async () => {
      const link = await seedLink();
      const { token } = await createConversion(link.code);
      await db.prisma.campConversion.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });

      expect((await request(app.getHttpServer()).get('/camp-conversions/not-a-token')).status).toBe(404);
      const expired = await request(app.getHttpServer()).get(`/camp-conversions/${token}`);
      expect(expired.status).toBe(410);
      expect(expired.body.errorCode).toBe('TOKEN_EXPIRED');
    });
  });

  describe('POST /camp-conversions/:token/email-link', () => {
    it('enqueues one EMAIL_CAMP_CONVERSION_LINK job to the form address carrying code + token', async () => {
      const link = await seedLink();
      const { token, body } = await createConversion(link.code);

      const res = await request(app.getHttpServer()).post(`/camp-conversions/${token}/email-link`);

      expect(res.status).toBe(202);
      const jobs = await db.prisma.outboxJob.findMany({ where: { type: 'EMAIL_CAMP_CONVERSION_LINK' } });
      expect(jobs).toHaveLength(1);
      expect(jobs[0].payload).toMatchObject({
        to: body.email,
        templateData: { firstName: 'Pat', trainerBusinessName: 'Camp Co', shareLinkCode: link.code, conversionToken: token },
      });
    });

    it('unknown token -> 404, expired -> 410, no job queued', async () => {
      const link = await seedLink();
      const { token } = await createConversion(link.code);
      expect((await request(app.getHttpServer()).post('/camp-conversions/nope/email-link')).status).toBe(404);
      await db.prisma.campConversion.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
      expect((await request(app.getHttpServer()).post(`/camp-conversions/${token}/email-link`)).status).toBe(410);
      expect(await db.prisma.outboxJob.count({ where: { type: 'EMAIL_CAMP_CONVERSION_LINK' } })).toBe(0);
    });
  });

  describe('POST /share-links/:code/redeem with conversionToken', () => {
    it('minor: only a password is needed - parent account + child profile, associated to the trainer, source recorded, token consumed', async () => {
      const link = await seedLink();
      const { token, body } = await createConversion(link.code, { source: 'EVALUATION' });

      const res = await request(app.getHttpServer())
        .post(`/share-links/${link.code}/redeem`)
        .send({ password: 'Password1', conversionToken: token });

      expect(res.status).toBe(201);
      expect(res.body.user).toMatchObject({ email: body.email, role: 'PLAYER_PARENT' });

      const user = await db.prisma.user.findUnique({ where: { email: body.email as string } });
      expect(user).toMatchObject({ firstName: 'Pat', lastName: 'Camper' });
      const profile = await db.prisma.playerProfile.findFirstOrThrow({ where: { accountUserId: user!.id } });
      expect(profile).toMatchObject({ name: 'Kid Camper', isSelf: false, gender: 'FEMALE' });
      const association = await db.prisma.playerTrainerAssociation.findFirstOrThrow({
        where: { trainerId: link.trainerId, playerProfileId: profile.id },
      });
      expect(association).toMatchObject({ status: 'ACTIVE', source: 'EVALUATION' });
      expect((await db.prisma.campConversion.findFirstOrThrow()).usedAt).not.toBeNull();

      // reused token -> 404 (and no second account)
      const reused = await request(app.getHttpServer())
        .post(`/share-links/${link.code}/redeem`)
        .send({ password: 'Password1', email: `${randomUUID()}@example.com`, conversionToken: token });
      expect(reused.status).toBe(404);
      const prefillAfter = await request(app.getHttpServer()).get(`/camp-conversions/${token}`);
      expect(prefillAfter.status).toBe(404);
    });

    it('adult player (age >= 18) registers for themselves', async () => {
      const link = await seedLink();
      const { token, body } = await createConversion(link.code, { playerAge: 30 });

      const res = await request(app.getHttpServer())
        .post(`/share-links/${link.code}/redeem`)
        .send({ password: 'Password1', conversionToken: token });

      expect(res.status).toBe(201);
      const user = await db.prisma.user.findUniqueOrThrow({ where: { email: body.email as string } });
      const profile = await db.prisma.playerProfile.findFirstOrThrow({ where: { accountUserId: user.id } });
      expect(profile.isSelf).toBe(true);
    });

    it('expired token -> 410 and nothing is created; a token minted for another link is 404', async () => {
      const link = await seedLink();
      const other = await seedLink();
      const expiring = await createConversion(link.code);
      const foreign = await createConversion(other.code);
      await db.prisma.campConversion.updateMany({
        where: { shareLinkId: (await db.prisma.shareLink.findUniqueOrThrow({ where: { code: link.code } })).id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      const expired = await request(app.getHttpServer())
        .post(`/share-links/${link.code}/redeem`)
        .send({ password: 'Password1', conversionToken: expiring.token });
      expect(expired.status).toBe(410);

      const wrongCode = await request(app.getHttpServer())
        .post(`/share-links/${link.code}/redeem`)
        .send({ password: 'Password1', conversionToken: foreign.token });
      expect(wrongCode.status).toBe(404);

      expect(await db.prisma.user.count({ where: { role: 'PLAYER_PARENT' } })).toBe(0);
      expect((await db.prisma.campConversion.findMany({ where: { usedAt: { not: null } } })).length).toBe(0);
    });

    it('email already registered -> 409, whole registration rolled back and the token stays usable', async () => {
      const link = await seedLink();
      const { token, body } = await createConversion(link.code);
      await db.prisma.user.create({
        data: {
          email: body.email as string,
          passwordHash: await argon2.hash(PASSWORD),
          role: 'PLAYER_PARENT',
          firstName: 'Already',
          lastName: 'Here',
          status: 'ACTIVE',
        },
      });

      const res = await request(app.getHttpServer())
        .post(`/share-links/${link.code}/redeem`)
        .send({ password: 'Password1', conversionToken: token });

      expect(res.status).toBe(409);
      expect(await db.prisma.playerTrainerAssociation.count()).toBe(0);
      expect((await db.prisma.campConversion.findFirstOrThrow()).usedAt).toBeNull();
      expect((await request(app.getHttpServer()).get(`/camp-conversions/${token}`)).status).toBe(200);
    });

    it('explicitly submitted fields win over the stored payload; no conversionToken keeps the ordinary flow', async () => {
      const link = await seedLink();
      const { token } = await createConversion(link.code);
      const email = `${randomUUID()}@example.com`;

      const res = await request(app.getHttpServer())
        .post(`/share-links/${link.code}/redeem`)
        .send({ password: 'Password1', email, playerName: 'Renamed Kid', conversionToken: token });

      expect(res.status).toBe(201);
      const user = await db.prisma.user.findUniqueOrThrow({ where: { email } });
      expect((await db.prisma.playerProfile.findFirstOrThrow({ where: { accountUserId: user.id } })).name).toBe('Renamed Kid');
    });
  });
});
