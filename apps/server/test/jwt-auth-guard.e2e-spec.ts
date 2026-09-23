import { randomUUID } from 'node:crypto';

import { Controller, Get, INestApplication, Module, Req, UseGuards } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { resetTestDatabase, startTestDatabase, stopTestDatabase, TestDatabase } from './setup/testcontainers.setup';

// Task 2.4 (arch §6.3, §20 DoD). Testcontainers-backed, exercising the real
// guard through a real HTTP request against a real Postgres — the DoD items
// below are all "does this actually happen end-to-end", not unit-level
// mocked behavior (that's jwt-auth.guard.spec.ts).
//
// Same env-var-before-import dance as prisma.service.spec.ts: `env` (and
// everything that transitively imports shared/config/config.module) is
// computed once at first import, so DATABASE_URL must be pointed at the
// container and modules re-required fresh via jest.resetModules() +
// require() before anything under test is touched.
describe('JwtAuthGuard (e2e, Task 2.4 DoD)', () => {
  jest.setTimeout(180_000);

  let db: TestDatabase;
  let app: INestApplication;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamically required after env is repointed, see beforeAll
  let jwtService: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let authSnapshotRepository: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prismaService: any;

  const originalDatabaseUrl = process.env.DATABASE_URL;

  beforeAll(async () => {
    db = await startTestDatabase();
    process.env.DATABASE_URL = db.connectionUri;

    // Deliberately no jest.resetModules() here (unlike prisma.service.spec.ts):
    // this file never statically imports anything under `../src/`, so
    // shared/config/config.module.ts (and the `env` it computes eagerly at
    // import time) has not been loaded anywhere in this file's module
    // registry yet — these are its first-ever requires in this process, so
    // there's nothing stale to reset. Resetting here would actually break
    // things: @nestjs/testing (imported statically above, before this point)
    // has already captured its OWN reference to @nestjs/core internally: a
    // reset would make a *second*, distinct `@nestjs/core` module instance
    // get pulled in transitively by the dynamic requires below (e.g. via
    // JwtAuthGuard's own `import { Reflector } from '@nestjs/core'`), and
    // Nest's DI matches providers by class reference — a `Reflector` from
    // that second instance would not satisfy `@nestjs/testing`'s injector,
    // which is still holding the first one. Skipping the reset keeps every
    // package in one single require realm; only the `../src/*` modules that
    // read `env` need to be required after DATABASE_URL is set, which a
    // plain (non-reset) `require()` already guarantees since they haven't
    // run yet.
    /* eslint-disable @typescript-eslint/no-require-imports -- deliberate, defers evaluation until after DATABASE_URL is set */
    const { JwtAuthGuard } = require('../src/shared/security/guards/jwt-auth.guard') as typeof import('../src/shared/security/guards/jwt-auth.guard');
    const { SecurityModule } = require('../src/shared/security/security.module') as typeof import('../src/shared/security/security.module');
    const { PrismaModule } = require('../src/shared/prisma/prisma.module') as typeof import('../src/shared/prisma/prisma.module');
    const { PrismaService } = require('../src/shared/prisma/prisma.service') as typeof import('../src/shared/prisma/prisma.service');
    const { AuthSnapshotRepository } = require('../src/shared/security/auth-snapshot.repository') as typeof import('../src/shared/security/auth-snapshot.repository');
    const { JwtService } = require('@nestjs/jwt') as typeof import('@nestjs/jwt');
    const { Reflector } = require('@nestjs/core') as typeof import('@nestjs/core');
    /* eslint-enable @typescript-eslint/no-require-imports */

    @Controller('probe')
    class ProbeController {
      @Get('single')
      @UseGuards(JwtAuthGuard)
      single(@Req() req: { authContext?: { userId: string } }) {
        return { userId: req.authContext?.userId };
      }

      // Two guard evaluations on one request — proves per-request memoization.
      @Get('double')
      @UseGuards(JwtAuthGuard, JwtAuthGuard)
      double(@Req() req: { authContext?: { userId: string } }) {
        return { userId: req.authContext?.userId };
      }
    }

    @Module({
      imports: [PrismaModule, SecurityModule],
      controllers: [ProbeController],
      // Reflector isn't auto-provided by a bare TestingModule the way a full
      // NestFactory.create() bootstrap provides it — JwtAuthGuard needs it.
      providers: [Reflector],
    })
    class ProbeModule {}

    const moduleRef = await Test.createTestingModule({ imports: [ProbeModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    jwtService = moduleRef.get(JwtService);
    authSnapshotRepository = moduleRef.get(AuthSnapshotRepository);
    prismaService = moduleRef.get(PrismaService);
  });

  afterAll(async () => {
    await app?.close();
    await stopTestDatabase(db);
    process.env.DATABASE_URL = originalDatabaseUrl;
  });

  afterEach(async () => {
    await resetTestDatabase(db);
    jest.restoreAllMocks();
  });

  interface SeedOverrides {
    status?: 'ACTIVE' | 'INACTIVE' | 'DELETED';
    tokenVersion?: number;
    mustChangePassword?: boolean;
    deletedAt?: Date;
  }

  async function insertUser(overrides: SeedOverrides = {}): Promise<string> {
    const id = randomUUID();
    await db.prisma.user.create({
      data: {
        id,
        email: `${id}@example.com`,
        passwordHash: 'hash',
        role: 'PLAYER_PARENT',
        firstName: 'A',
        lastName: 'B',
        status: overrides.status ?? 'ACTIVE',
        tokenVersion: overrides.tokenVersion ?? 0,
        mustChangePassword: overrides.mustChangePassword ?? false,
        deletedAt: overrides.deletedAt ?? null,
      },
    });
    return id;
  }

  function signToken(sub: string, tv: number): Promise<string> {
    return jwtService.signAsync(
      { sub, role: 'PLAYER_PARENT', typ: 'ADULT', gid: null, tid: null, tv, jti: randomUUID() },
      { expiresIn: '15m' },
    );
  }

  it('rejects an INACTIVE user — the guard sees the row (proves findUnique) and rejects on status, not a not-found shape', async () => {
    const userId = await insertUser({ status: 'INACTIVE' });
    const token = await signToken(userId, 0);

    const res = await request(app.getHttpServer()).get('/probe/single').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(401);
    expect(res.body.errorCode).toBe('ACCOUNT_INACTIVE');
  });

  it('rejects a DELETED (soft-deleted) user — same findUnique-vs-findFirst proof, and the row really is invisible to findFirst', async () => {
    const userId = await insertUser({ status: 'DELETED', deletedAt: new Date() });
    const token = await signToken(userId, 0);

    // The soft-delete extension (Task 1.5), applied here via PrismaService's
    // `.extended` surface (Task 2.4's fix — see prisma.service.ts), really
    // would hide this row from a findFirst call...
    const viaFindFirst = await prismaService.extended.user.findFirst({ where: { id: userId } });
    expect(viaFindFirst).toBeNull();

    // ...yet the guard (which explicitly uses findUnique, never findFirst)
    // still sees it and rejects with the precise ACCOUNT_INACTIVE code.
    const res = await request(app.getHttpServer()).get('/probe/single').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
    expect(res.body.errorCode).toBe('ACCOUNT_INACTIVE');
  });

  it('rejects the very next request once tokenVersion is bumped, even though the token itself is still unexpired and validly signed', async () => {
    const userId = await insertUser({ status: 'ACTIVE', tokenVersion: 0 });
    const token = await signToken(userId, 0);

    const first = await request(app.getHttpServer()).get('/probe/single').set('Authorization', `Bearer ${token}`);
    expect(first.status).toBe(200);

    // Simulates deactivation/GDPR-delete/password-reset bumping tokenVersion.
    await db.prisma.user.update({ where: { id: userId }, data: { tokenVersion: { increment: 1 } } });

    const second = await request(app.getHttpServer()).get('/probe/single').set('Authorization', `Bearer ${token}`);
    expect(second.status).toBe(401);
    expect(second.body.errorCode).toBe('ACCOUNT_INACTIVE');
  });

  // Task 2.23 DoD sweep: arch §20's exact wording — "deactivating a user
  // causes their already-issued, still-unexpired access token to be
  // rejected on the very next request". Distinct from the tokenVersion-only
  // test above: this simulates a real deactivate action (status flips to
  // INACTIVE *and* tokenVersion bumps together, per arch §6.3's "Deactivation
  // additionally revokes all RefreshToken rows" / tokenVersion-increment
  // list) against a token that was validly issued while the user was still
  // ACTIVE, proving no stale cache lets it keep working.
  it('deactivating a user rejects their already-issued, still-unexpired access token on the very next request', async () => {
    const userId = await insertUser({ status: 'ACTIVE', tokenVersion: 0 });
    const token = await signToken(userId, 0);

    const beforeDeactivation = await request(app.getHttpServer())
      .get('/probe/single')
      .set('Authorization', `Bearer ${token}`);
    expect(beforeDeactivation.status).toBe(200);

    // Simulates the deactivate action (Phase 3's POST /users/:id/deactivate,
    // not built yet) directly against the DB.
    await db.prisma.user.update({ where: { id: userId }, data: { status: 'INACTIVE', tokenVersion: { increment: 1 } } });

    const afterDeactivation = await request(app.getHttpServer())
      .get('/probe/single')
      .set('Authorization', `Bearer ${token}`);
    expect(afterDeactivation.status).toBe(401);
    expect(afterDeactivation.body.errorCode).toBe('ACCOUNT_INACTIVE');
  });

  it("completes the guard's User read without the tenant-guard extension throwing (proves the pre-ALS ordering, arch §6.3 constraint 2)", async () => {
    const userId = await insertUser({ status: 'ACTIVE' });
    const token = await signToken(userId, 0);

    const res = await request(app.getHttpServer()).get('/probe/single').set('Authorization', `Bearer ${token}`);

    // Had the extension's assertion fired (e.g. if User were mistakenly
    // treated as tenant-owned, or if a scope had already been published),
    // it throws TenantScopeViolationError -> 500 TENANT_SCOPE_VIOLATION.
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ userId });
  });

  it('memoizes the resolved AuthContext per request — two guard evaluations on one request cause exactly one DB read', async () => {
    const userId = await insertUser({ status: 'ACTIVE' });
    const token = await signToken(userId, 0);
    const spy = jest.spyOn(authSnapshotRepository, 'findForAuth');

    const res = await request(app.getHttpServer()).get('/probe/double').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ userId });
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
