import { Controller, Get, INestApplication, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { Throttle, ThrottlerModule } from '@nestjs/throttler';
import request from 'supertest';

// `env` is a module-level const read by the guard at request time, so the
// mock exposes one mutable object each test reconfigures.
const mockEnv: { NODE_ENV: string; RATE_LIMITS_DISABLED: boolean } = { NODE_ENV: 'test', RATE_LIMITS_DISABLED: false };
jest.mock('../../config/config.module', () => ({ env: mockEnv }));

import { AuthThrottlerGuard, buildAuthThrottlerConfigs } from './auth-throttler.guard';

describe('AuthThrottlerGuard — RATE_LIMITS_DISABLED', () => {
  let app: INestApplication;

  beforeAll(async () => {
    @Controller('probe')
    class ProbeController {
      @Throttle({ 'auth-ip': { limit: 1, ttl: 60_000 }, 'token-consume': { limit: 1, ttl: 60_000 } })
      @Get('limited')
      limited() {
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

  async function hitTwice(): Promise<number[]> {
    const first = await request(app.getHttpServer()).get('/probe/limited');
    const second = await request(app.getHttpServer()).get('/probe/limited');
    return [first.status, second.status];
  }

  it('skips every throttle when RATE_LIMITS_DISABLED=true outside production', async () => {
    mockEnv.NODE_ENV = 'test';
    mockEnv.RATE_LIMITS_DISABLED = true;

    for (let i = 0; i < 5; i += 1) {
      const res = await request(app.getHttpServer()).get('/probe/limited');
      expect(res.status).toBe(200);
    }
  });

  it('is INERT in production: the same flag does not disable throttling', async () => {
    mockEnv.NODE_ENV = 'production';
    mockEnv.RATE_LIMITS_DISABLED = true;

    const [first, second] = await hitTwice();
    // Counters are shared with the previous test's hits (same IP, same
    // route); either way the limit of 1 is exceeded and enforced.
    expect(first === 200 || first === 429).toBe(true);
    expect(second).toBe(429);
  });

  it('enforces throttles when the flag is false', async () => {
    mockEnv.NODE_ENV = 'test';
    mockEnv.RATE_LIMITS_DISABLED = false;

    const res = await request(app.getHttpServer()).get('/probe/limited');
    expect(res.status).toBe(429);
  });
});
