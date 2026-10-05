import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import sharp from 'sharp';
import request from 'supertest';

import { resetTestDatabase, startTestDatabase, stopTestDatabase, TestDatabase } from './setup/testcontainers.setup';

// US-01.11 (profile photo) + US-01.14 (portal logo): real upload -> real
// static serving -> PATCH with the returned URL, over the full AppModule.
describe('Storage uploads (e2e)', () => {
  jest.setTimeout(180_000);

  let db: TestDatabase;
  let app: INestApplication;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamically required after DATABASE_URL is set
  let jwtService: any;
  let uploadsDir: string;

  const originalDatabaseUrl = process.env.DATABASE_URL;
  const originalUploadsDir = process.env.UPLOADS_DIR;
  const originalPublicApiUrl = process.env.PUBLIC_API_URL;
  const PUBLIC_API_URL = 'http://localhost:4999';

  beforeAll(async () => {
    db = await startTestDatabase();
    uploadsDir = await mkdtemp(join(tmpdir(), 'pp-e2e-uploads-'));
    process.env.DATABASE_URL = db.connectionUri;
    process.env.UPLOADS_DIR = uploadsDir;
    process.env.PUBLIC_API_URL = PUBLIC_API_URL;

    /* eslint-disable @typescript-eslint/no-require-imports -- deliberate, defers evaluation until after env is set */
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
    await rm(uploadsDir, { recursive: true, force: true });
    process.env.DATABASE_URL = originalDatabaseUrl;
    restoreEnv('UPLOADS_DIR', originalUploadsDir);
    restoreEnv('PUBLIC_API_URL', originalPublicApiUrl);
  });

  afterEach(async () => {
    await resetTestDatabase(db);
  });

  function restoreEnv(name: string, value: string | undefined): void {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }

  async function insertUser(role: string): Promise<{ id: string; role: string }> {
    const id = randomUUID();
    await db.prisma.user.create({
      data: { id, email: `${id}@example.com`, passwordHash: await argon2.hash('CorrectHorseBattery1'), role, firstName: 'A', lastName: 'B', status: 'ACTIVE' },
    });
    return { id, role };
  }

  function signToken(user: { id: string; role: string }, extra: Record<string, unknown> = {}): Promise<string> {
    return jwtService.signAsync(
      { sub: user.id, role: user.role, typ: 'ADULT', gid: null, tid: null, tv: 0, jti: randomUUID(), ...extra },
      { expiresIn: '15m' },
    );
  }

  async function trainerSession(): Promise<{ userId: string; trainerId: string; token: string }> {
    const user = await insertUser('TRAINER');
    const trainerId = randomUUID();
    await db.prisma.trainerProfile.create({ data: { id: trainerId, userId: user.id, businessName: 'Acme' } });
    return { userId: user.id, trainerId, token: await signToken(user, { tid: trainerId }) };
  }

  async function parentSession(): Promise<{ userId: string; token: string }> {
    const user = await insertUser('PLAYER_PARENT');
    return { userId: user.id, token: await signToken(user) };
  }

  const png = (width = 800, height = 400) =>
    sharp({ create: { width, height, channels: 3, background: { r: 10, g: 120, b: 200 } } })
      .png()
      .toBuffer();

  const svg = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><script>alert(1)</script><circle cx="200" cy="200" r="150" fill="green"/></svg>',
  );

  describe('POST /storage/logo', () => {
    it('stores a 200x200-bounded PNG and returns an absolute http URL that GET /uploads serves cross-origin', async () => {
      const trainer = await trainerSession();

      const res = await request(app.getHttpServer())
        .post('/storage/logo')
        .set('Authorization', `Bearer ${trainer.token}`)
        .attach('file', await png(), { filename: 'logo.png', contentType: 'image/png' });

      expect(res.status).toBe(201);
      expect(res.body.logoUrl).toMatch(new RegExp(`^${PUBLIC_API_URL}/uploads/logo-[0-9a-f-]+\\.png$`));

      const served = await request(app.getHttpServer()).get(new URL(res.body.logoUrl).pathname);
      expect(served.status).toBe(200);
      expect(served.headers['content-type']).toBe('image/png');
      expect(served.headers['cross-origin-resource-policy']).toBe('cross-origin');
      const meta = await sharp(served.body as Buffer).metadata();
      expect([meta.format, meta.width, meta.height]).toEqual(['png', 200, 100]);
    });

    it('accepts SVG but only ever stores a rasterised PNG (no script reaches browsers)', async () => {
      const trainer = await trainerSession();

      const res = await request(app.getHttpServer())
        .post('/storage/logo')
        .set('Authorization', `Bearer ${trainer.token}`)
        .attach('file', svg, { filename: 'logo.svg', contentType: 'image/svg+xml' });

      expect(res.status).toBe(201);
      expect(res.body.logoUrl).toMatch(/\.png$/);
      const served = await request(app.getHttpServer()).get(new URL(res.body.logoUrl).pathname);
      expect(served.headers['content-type']).toBe('image/png');
      expect((served.body as Buffer).toString('latin1')).not.toContain('<script');

      const files = await readdir(uploadsDir);
      expect(files.some((f) => f.endsWith('.svg'))).toBe(false);
    });

    it('rejects a non-image with a mislabelled mimetype -> 400', async () => {
      const trainer = await trainerSession();

      const res = await request(app.getHttpServer())
        .post('/storage/logo')
        .set('Authorization', `Bearer ${trainer.token}`)
        .attach('file', Buffer.from('<html>not an image</html>'), { filename: 'logo.png', contentType: 'image/png' });

      expect(res.status).toBe(400);
      expect(res.body.errorCode).toBe('VALIDATION_ERROR');
    });

    it('rejects a file over 2MB -> 400', async () => {
      const trainer = await trainerSession();

      const res = await request(app.getHttpServer())
        .post('/storage/logo')
        .set('Authorization', `Bearer ${trainer.token}`)
        .attach('file', Buffer.alloc(2 * 1024 * 1024 + 10, 1), { filename: 'big.png', contentType: 'image/png' });

      expect(res.status).toBe(400);
    });

    it('a PLAYER_PARENT cannot upload a logo -> 403', async () => {
      const parent = await parentSession();

      const res = await request(app.getHttpServer())
        .post('/storage/logo')
        .set('Authorization', `Bearer ${parent.token}`)
        .attach('file', await png(), { filename: 'logo.png', contentType: 'image/png' });

      expect(res.status).toBe(403);
    });

    it('the returned URL passes PATCH /trainers/:id/branding, while javascript:/file: URLs are rejected', async () => {
      const trainer = await trainerSession();
      const upload = await request(app.getHttpServer())
        .post('/storage/logo')
        .set('Authorization', `Bearer ${trainer.token}`)
        .attach('file', await png(), { filename: 'logo.png', contentType: 'image/png' });

      const ok = await request(app.getHttpServer())
        .patch(`/trainers/${trainer.trainerId}/branding`)
        .set('Authorization', `Bearer ${trainer.token}`)
        .send({ logoUrl: upload.body.logoUrl });
      expect(ok.status).toBe(200);
      expect(ok.body.logoUrl).toBe(upload.body.logoUrl);

      for (const bad of ['javascript:alert(1)', 'file:///etc/passwd', 'data:image/svg+xml;base64,AAAA']) {
        const res = await request(app.getHttpServer())
          .patch(`/trainers/${trainer.trainerId}/branding`)
          .set('Authorization', `Bearer ${trainer.token}`)
          .send({ logoUrl: bad });
        expect(res.status).toBe(400);
      }
    });
  });

  describe('POST /storage/photo', () => {
    it('returns a 512px photo and a 128px thumbnail, both servable', async () => {
      const parent = await parentSession();

      const res = await request(app.getHttpServer())
        .post('/storage/photo')
        .set('Authorization', `Bearer ${parent.token}`)
        .attach('file', await png(900, 600), { filename: 'me.png', contentType: 'image/png' });

      expect(res.status).toBe(201);
      const [photo, thumb] = await Promise.all([
        request(app.getHttpServer()).get(new URL(res.body.url).pathname),
        request(app.getHttpServer()).get(new URL(res.body.thumbnailUrl).pathname),
      ]);
      const photoMeta = await sharp(photo.body as Buffer).metadata();
      const thumbMeta = await sharp(thumb.body as Buffer).metadata();
      expect([photoMeta.width, photoMeta.height]).toEqual([512, 512]);
      expect([thumbMeta.width, thumbMeta.height]).toEqual([128, 128]);
    });

    it('accepts SVG (rasterised) and rejects unsupported bytes / oversize / unauthenticated', async () => {
      const parent = await parentSession();

      const okSvg = await request(app.getHttpServer())
        .post('/storage/photo')
        .set('Authorization', `Bearer ${parent.token}`)
        .attach('file', svg, { filename: 'me.svg', contentType: 'image/svg+xml' });
      expect(okSvg.status).toBe(201);

      const bad = await request(app.getHttpServer())
        .post('/storage/photo')
        .set('Authorization', `Bearer ${parent.token}`)
        .attach('file', Buffer.from('GIF89a-not-really'), { filename: 'me.gif', contentType: 'image/gif' });
      expect(bad.status).toBe(400);

      const big = await request(app.getHttpServer())
        .post('/storage/photo')
        .set('Authorization', `Bearer ${parent.token}`)
        .attach('file', Buffer.alloc(2 * 1024 * 1024 + 10, 1), { filename: 'big.png', contentType: 'image/png' });
      expect(big.status).toBe(400);

      const anon = await request(app.getHttpServer())
        .post('/storage/photo')
        .attach('file', await png(), { filename: 'me.png', contentType: 'image/png' });
      expect(anon.status).toBe(401);
    });

    it('the uploaded URL is accepted by PATCH /me, PATCH /player-profiles/:id and POST /player-profiles; null clears it', async () => {
      const parent = await parentSession();
      const upload = await request(app.getHttpServer())
        .post('/storage/photo')
        .set('Authorization', `Bearer ${parent.token}`)
        .attach('file', await png(300, 300), { filename: 'me.png', contentType: 'image/png' });

      const me = await request(app.getHttpServer())
        .patch('/me')
        .set('Authorization', `Bearer ${parent.token}`)
        .send({ photoUrl: upload.body.url });
      expect(me.status).toBe(200);
      expect(me.body.photoUrl).toBe(upload.body.url);

      const created = await request(app.getHttpServer())
        .post('/player-profiles')
        .set('Authorization', `Bearer ${parent.token}`)
        .send({ name: 'Kiddo', dateOfBirth: '2016-05-05', gender: 'FEMALE', photoUrl: upload.body.url });
      expect(created.status).toBe(201);
      expect(created.body.photoUrl).toBe(upload.body.url);

      const patched = await request(app.getHttpServer())
        .patch(`/player-profiles/${created.body.id}`)
        .set('Authorization', `Bearer ${parent.token}`)
        .send({ photoUrl: null });
      expect(patched.status).toBe(200);
      expect(patched.body.photoUrl).toBeNull();

      const rejected = await request(app.getHttpServer())
        .patch('/me')
        .set('Authorization', `Bearer ${parent.token}`)
        .send({ photoUrl: 'javascript:alert(1)' });
      expect(rejected.status).toBe(400);
    });
  });

  describe('profile surfaces', () => {
    it('GET /me/bootstrap exposes user.photoUrl so the shell can render the avatar', async () => {
      const parent = await parentSession();
      const upload = await request(app.getHttpServer())
        .post('/storage/photo')
        .set('Authorization', `Bearer ${parent.token}`)
        .attach('file', await png(300, 300), { filename: 'me.png', contentType: 'image/png' });
      await request(app.getHttpServer()).patch('/me').set('Authorization', `Bearer ${parent.token}`).send({ photoUrl: upload.body.url });

      const res = await request(app.getHttpServer()).get('/me/bootstrap').set('Authorization', `Bearer ${parent.token}`);

      expect(res.status).toBe(200);
      expect(res.body.user.photoUrl).toBe(upload.body.url);
    });

    it('PATCH /trainers/:id accepts null to clear optional business fields', async () => {
      const trainer = await trainerSession();
      await db.prisma.trainerProfile.update({
        where: { id: trainer.trainerId },
        data: { address: '1 Main St', website: 'https://acme.example.com', description: 'Hello' },
      });

      const res = await request(app.getHttpServer())
        .patch(`/trainers/${trainer.trainerId}`)
        .set('Authorization', `Bearer ${trainer.token}`)
        .send({ businessName: 'Acme Sports', address: null, website: null, description: null });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ businessName: 'Acme Sports', address: null, website: null, description: null });
    });
  });

  describe('GET /uploads/:key', () => {
    it('404s for a missing file, a non-image extension, and is public', async () => {
      expect((await request(app.getHttpServer()).get('/uploads/nope.png')).status).toBe(404);
      expect((await request(app.getHttpServer()).get('/uploads/secret.svg')).status).toBe(404);
      expect((await request(app.getHttpServer()).get('/uploads/..%2F..%2Fpackage.json')).status).toBe(404);
    });
  });
});
