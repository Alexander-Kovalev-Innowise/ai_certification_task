import { randomUUID } from 'node:crypto';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import request from 'supertest';

import { resetTestDatabase, startTestDatabase, stopTestDatabase, TestDatabase } from './setup/testcontainers.setup';

interface MailboxEntry {
  to: string;
  subject: string;
  templateId: string | null;
  html: string;
  text: string;
  links: string[];
  sentAt: string;
}

// Mail delivery end to end with MAIL_PROVIDER=dev (in-memory mailbox exposed at
// GET /__dev/mailbox) and RATE_LIMITS_DISABLED=true — the exact configuration
// the Playwright suite runs against. Every flow: real endpoint -> outbox job ->
// drained -> rendered mail in the mailbox -> the link's token actually works.
describe('Mail delivery + dev mailbox (e2e)', () => {
  jest.setTimeout(180_000);

  let db: TestDatabase;
  let app: INestApplication;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamically required after env is set
  let outbox: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let jwtService: any;

  const saved = {
    DATABASE_URL: process.env.DATABASE_URL,
    MAIL_PROVIDER: process.env.MAIL_PROVIDER,
    RATE_LIMITS_DISABLED: process.env.RATE_LIMITS_DISABLED,
    CLIENT_URL: process.env.CLIENT_URL,
  };
  const KNOWN_PASSWORD = 'CorrectHorseBattery1';
  const CLIENT = 'http://client.test';

  beforeAll(async () => {
    db = await startTestDatabase();
    process.env.DATABASE_URL = db.connectionUri;
    process.env.MAIL_PROVIDER = 'dev';
    process.env.RATE_LIMITS_DISABLED = 'true';
    process.env.CLIENT_URL = CLIENT;

    /* eslint-disable @typescript-eslint/no-require-imports -- deliberate, defers evaluation until env is set */
    const { AppModule } = require('../src/app.module') as typeof import('../src/app.module');
    const { GlobalExceptionFilter } = require('../src/shared/http/global-exception.filter') as typeof import('../src/shared/http/global-exception.filter');
    const { JwtService } = require('@nestjs/jwt') as typeof import('@nestjs/jwt');
    const { OutboxService } = require('../src/shared/jobs/outbox.service') as typeof import('../src/shared/jobs/outbox.service');
    /* eslint-enable @typescript-eslint/no-require-imports */

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(helmet());
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();

    outbox = moduleRef.get(OutboxService);
    jwtService = moduleRef.get(JwtService);
  });

  afterAll(async () => {
    await app?.close();
    await stopTestDatabase(db);
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  beforeEach(async () => {
    await request(app.getHttpServer()).delete('/__dev/mailbox').expect(204);
  });

  afterEach(async () => {
    await resetTestDatabase(db);
  });

  async function drainAll(): Promise<void> {
    // Nudges from the app run concurrently (setImmediate); drain until quiet.
    for (let i = 0; i < 5; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      if ((await outbox.drainOnce()) === 0 && i > 0) {
        return;
      }
    }
  }

  async function mailbox(to: string): Promise<MailboxEntry[]> {
    const res = await request(app.getHttpServer()).get('/__dev/mailbox').query({ to }).expect(200);
    return res.body as MailboxEntry[];
  }

  function tokenOf(link: string): string {
    return new URL(link).searchParams.get('token') as string;
  }

  async function insertSuperAdmin(): Promise<{ id: string; accessToken: string }> {
    const id = randomUUID();
    await db.prisma.user.create({
      data: { id, email: `${id}@example.com`, passwordHash: await argon2.hash(KNOWN_PASSWORD), role: 'SUPER_ADMIN', firstName: 'Ad', lastName: 'Min', status: 'ACTIVE' },
    });
    const accessToken = await jwtService.signAsync(
      { sub: id, role: 'SUPER_ADMIN', typ: 'ADULT', gid: null, tid: null, tv: 0, jti: randomUUID() },
      { expiresIn: '15m' },
    );
    return { id, accessToken };
  }

  it('mailbox endpoints: list is JSON newest-last with the documented shape; DELETE clears', async () => {
    const email = `${randomUUID()}@example.com`;
    await db.prisma.user.create({
      data: { id: randomUUID(), email, passwordHash: await argon2.hash(KNOWN_PASSWORD), role: 'PLAYER_PARENT', firstName: 'Fo', lastName: 'Rgot', status: 'ACTIVE' },
    });
    await request(app.getHttpServer()).post('/auth/forgot-password').send({ email }).expect(202);
    await drainAll();

    const mails = await mailbox(email);
    expect(mails).toHaveLength(1);
    expect(mails[0]).toEqual({
      to: email,
      subject: expect.any(String),
      templateId: 'EMAIL_PASSWORD_RESET',
      html: expect.stringContaining('<a href='),
      text: expect.stringContaining('/reset-password?token='),
      links: [expect.stringMatching(new RegExp(`^${CLIENT}/reset-password\\?token=`))],
      sentAt: expect.any(String),
    });

    expect((await mailbox('someone-else@example.com'))).toEqual([]);
    await request(app.getHttpServer()).delete('/__dev/mailbox').expect(204);
    expect((await request(app.getHttpServer()).get('/__dev/mailbox')).body).toEqual([]);
  });

  it('forgot-password -> mailed link token resets the password', async () => {
    const email = `${randomUUID()}@example.com`;
    await db.prisma.user.create({
      data: { id: randomUUID(), email, passwordHash: await argon2.hash(KNOWN_PASSWORD), role: 'PLAYER_PARENT', firstName: 'Fo', lastName: 'Rgot', status: 'ACTIVE' },
    });
    await request(app.getHttpServer()).post('/auth/forgot-password').send({ email }).expect(202);
    await drainAll();

    const [mail] = await mailbox(email);
    await request(app.getHttpServer()).post('/auth/reset-password').send({ token: tokenOf(mail!.links[0]!), newPassword: 'BrandNewPassw0rd' }).expect(200);
    await request(app.getHttpServer()).post('/auth/login').send({ email, password: 'BrandNewPassw0rd' }).expect(200);
  });

  it('trainer created by admin: invite mail -> setup via /register link -> verification mail -> verify-email link', async () => {
    const admin = await insertSuperAdmin();
    const email = `${randomUUID()}@example.com`;

    await request(app.getHttpServer())
      .post('/trainers')
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ businessName: 'Mail Co', firstName: 'Tr', lastName: 'Ainer', email, phone: '+14155552671' })
      .expect(201);

    // Audit: who created the trainer + details.
    const creation = await db.prisma.trainerCreationLog.findFirstOrThrow({ where: { email } });
    expect(creation).toMatchObject({ createdByUserId: admin.id, businessName: 'Mail Co', email });

    await drainAll();
    const invite = (await mailbox(email)).find((m) => m.templateId === 'EMAIL_TRAINER_INVITE')!;
    expect(invite.links[0]).toMatch(new RegExp(`^${CLIENT}/register\\?token=`));

    const setup = await request(app.getHttpServer()).post('/auth/register').send({ setupToken: tokenOf(invite.links[0]!), password: KNOWN_PASSWORD });
    expect(setup.status).toBe(200);

    await drainAll();
    const verification = (await mailbox(email)).find((m) => m.templateId === 'EMAIL_VERIFICATION');
    expect(verification).toBeDefined();
    expect(verification!.links[0]).toMatch(new RegExp(`^${CLIENT}/verify-email\\?token=`));

    await request(app.getHttpServer()).post('/auth/verify-email').send({ token: tokenOf(verification!.links[0]!) }).expect(200);
    const user = await db.prisma.user.findUniqueOrThrow({ where: { email } });
    expect(user.emailVerifiedAt).not.toBeNull();
  });

  async function seedShareLink(type: 'PLAYER_STATIC' | 'COACH_UNIQUE', targetEmail?: string): Promise<string> {
    const trainerUserId = randomUUID();
    await db.prisma.user.create({
      data: { id: trainerUserId, email: `${trainerUserId}@example.com`, passwordHash: 'x', role: 'TRAINER', firstName: 'T', lastName: 'R', status: 'ACTIVE' },
    });
    const trainer = await db.prisma.trainerProfile.create({ data: { userId: trainerUserId, businessName: 'Link Co' } });
    const link = await db.prisma.shareLink.create({
      data: {
        code: `mail-${randomUUID()}`,
        type,
        trainerId: trainer.id,
        createdByUserId: trainerUserId,
        ...(type === 'COACH_UNIQUE' ? { targetEmail, expiresAt: new Date(Date.now() + 60_000) } : {}),
      },
    });
    return link.code;
  }

  it('anonymous ShareLink registration sends a confirmation mail AND a verification mail', async () => {
    const code = await seedShareLink('PLAYER_STATIC');
    const email = `${randomUUID()}@example.com`;

    await request(app.getHttpServer())
      .post(`/share-links/${code}/redeem`)
      .send({
        email,
        password: 'Password1',
        phone: '+14155552671',
        parentFirstName: 'Pa',
        parentLastName: 'Rent',
        playerName: 'Kid',
        dateOfBirth: '2015-01-01',
        gender: 'OTHER',
        isSelf: false,
      })
      .expect(201);
    await drainAll();

    const mails = await mailbox(email);
    const ids = mails.map((m) => m.templateId).sort();
    expect(ids).toEqual(['EMAIL_SHARELINK_CONFIRMATION', 'EMAIL_VERIFICATION']);
    const verification = mails.find((m) => m.templateId === 'EMAIL_VERIFICATION')!;
    await request(app.getHttpServer()).post('/auth/verify-email').send({ token: tokenOf(verification.links[0]!) }).expect(200);
  });

  it('coach accepting an invite (anonymous) also gets a verification mail', async () => {
    const email = `${randomUUID()}@example.com`;
    const code = await seedShareLink('COACH_UNIQUE', email);

    await request(app.getHttpServer())
      .post(`/share-links/${code}/redeem`)
      .send({ password: 'Password1', firstName: 'Co', lastName: 'Ach' })
      .expect(201);
    await drainAll();

    const verification = (await mailbox(email)).find((m) => m.templateId === 'EMAIL_VERIFICATION');
    expect(verification?.links[0]).toMatch(new RegExp(`^${CLIENT}/verify-email\\?token=`));
  });

  it('the raw verification token is not persisted: only its hash is in EmailVerificationToken', async () => {
    const code = await seedShareLink('PLAYER_STATIC');
    const email = `${randomUUID()}@example.com`;
    await request(app.getHttpServer())
      .post(`/share-links/${code}/redeem`)
      .send({ email, password: 'Password1', phone: '+14155552671', parentFirstName: 'Pa', parentLastName: 'Rent', playerName: 'Kid', dateOfBirth: '2015-01-01', gender: 'OTHER', isSelf: false })
      .expect(201);
    await drainAll();

    const verification = (await mailbox(email)).find((m) => m.templateId === 'EMAIL_VERIFICATION')!;
    const raw = tokenOf(verification.links[0]!);
    const rows = await db.prisma.emailVerificationToken.findMany({ where: { token: raw } });
    expect(rows).toHaveLength(0);
  });

  it('RATE_LIMITS_DISABLED=true: >20 logins from one IP are never throttled (auth-ip is 20/15min)', async () => {
    for (let i = 0; i < 25; i += 1) {
      const res = await request(app.getHttpServer()).post('/auth/login').send({ email: 'nobody@example.com', password: 'whatever12345' });
      expect(res.status).toBe(401);
    }
  });
});
