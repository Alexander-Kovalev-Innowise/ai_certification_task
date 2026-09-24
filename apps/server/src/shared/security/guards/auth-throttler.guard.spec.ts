import { Controller, Get, INestApplication, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { Throttle, ThrottlerModule } from '@nestjs/throttler';
import request from 'supertest';

import {
  authIdentityTracker,
  AuthThrottlerGuard,
  buildAuthThrottlerConfigs,
  impersonationTracker,
} from './auth-throttler.guard';

describe('authIdentityTracker (Task 2.7)', () => {
  it('returns a sha256 hex digest, never the raw email', () => {
    const tracker = authIdentityTracker({ body: { email: 'Someone@Example.com' }, path: '/auth/login' });

    expect(tracker).toMatch(/^[a-f0-9]{64}$/);
    expect(tracker).not.toContain('someone');
    expect(tracker).not.toContain('example.com');
  });

  it('is deterministic and case/whitespace-normalized for the same route', () => {
    const a = authIdentityTracker({ body: { email: '  Someone@Example.com  ' }, path: '/auth/login' });
    const b = authIdentityTracker({ body: { email: 'someone@example.com' }, path: '/auth/login' });

    expect(a).toBe(b);
  });

  it('scopes the hash to the route, so the same email on two routes differs', () => {
    const login = authIdentityTracker({ body: { email: 'a@b.com' }, path: '/auth/login' });
    const forgot = authIdentityTracker({ body: { email: 'a@b.com' }, path: '/auth/forgot-password' });

    expect(login).not.toBe(forgot);
  });
});

describe('impersonationTracker (Task 2.7, fallback fixed Task 7.1)', () => {
  it("uses AuthContext.userId (the acting admin's effective id) when already present", () => {
    expect(impersonationTracker({ authContext: { userId: 'admin-1' } })).toBe('admin-1');
  });

  it('falls back to a stable value when there is no AuthContext and no bearer token', () => {
    expect(impersonationTracker({})).toBe('anonymous');
  });

  // AuthThrottlerGuard runs BEFORE JwtAuthGuard in the real pipeline (arch
  // §5), so `request.authContext` is never actually set when this tracker
  // runs against a real request — only in a hand-built object like the two
  // tests above. This is the path that's really exercised in production.
  it("decodes `sub` straight off the bearer token when AuthContext isn't set yet (the real pipeline order)", () => {
    const payload = Buffer.from(JSON.stringify({ sub: 'admin-42', role: 'SUPER_ADMIN' })).toString('base64url');
    const fakeToken = `header.${payload}.signature`;

    expect(impersonationTracker({ headers: { authorization: `Bearer ${fakeToken}` } })).toBe('admin-42');
  });

  it('falls back to anonymous for a malformed bearer token', () => {
    expect(impersonationTracker({ headers: { authorization: 'Bearer not-a-jwt' } })).toBe('anonymous');
  });
});

describe('AuthThrottlerGuard opt-in behavior (Task 2.7, e2e-style, no Testcontainers needed)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    @Controller('probe')
    class ProbeController {
      // Lowered limit/ttl override for a fast test — proves a route that
      // explicitly opts in via @Throttle({'auth-ip': {...}}) is enforced.
      @Throttle({ 'auth-ip': { limit: 2, ttl: 1000 } })
      @Get('opted-in')
      optedIn() {
        return { ok: true };
      }

      // No @Throttle at all — only the always-on `default` (300/60s)
      // applies; `auth-ip` must be skipped entirely, proving the opt-in gate
      // actually gates instead of silently applying its global 20/15min
      // ceiling to every route.
      @Get('opted-out')
      optedOut() {
        return { ok: true };
      }
    }

    @Module({
      imports: [ThrottlerModule.forRoot(buildAuthThrottlerConfigs())],
      controllers: [ProbeController],
      providers: [{ provide: APP_GUARD, useClass: AuthThrottlerGuard }],
    })
    class ProbeModule {}

    const moduleRef = await Test.createTestingModule({ imports: [ProbeModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('enforces the named limit with 429 + Retry-After once a route opts in via @Throttle', async () => {
    await request(app.getHttpServer()).get('/probe/opted-in').expect(200);
    await request(app.getHttpServer()).get('/probe/opted-in').expect(200);

    const res = await request(app.getHttpServer()).get('/probe/opted-in');
    expect(res.status).toBe(429);
    // Non-'default' named throttlers get a per-throttler suffixed header
    // (`Retry-After-<name>`), per @nestjs/throttler's own handleRequest.
    const retryAfterHeader = Object.keys(res.headers).find((h) => h.toLowerCase().startsWith('retry-after'));
    expect(retryAfterHeader).toBeDefined();
  });

  it('does not apply auth-ip to a route that never declared it, even well past its 20/15min ceiling', async () => {
    for (let i = 0; i < 25; i += 1) {
       
      await request(app.getHttpServer()).get('/probe/opted-out').expect(200);
    }
  });
});
