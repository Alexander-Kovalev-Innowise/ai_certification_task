import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { GlobalExceptionFilter } from '../src/shared/http/global-exception.filter';

// Mirrors main.ts's bootstrap pipeline (Task 0.11) — Nest e2e tests build
// their own INestApplication from the module graph rather than exercising
// main.ts's bootstrap() directly, so the same wiring is replicated here.
describe('Bootstrap pipeline (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.use(helmet());
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('boots and responds (404 for an unmatched route, not a connection failure)', async () => {
    const res = await request(app.getHttpServer()).get('/some-unknown-route');
    expect(res.status).toBe(404);
  });

  it('returns 400 VALIDATION_ERROR, not a raw stack trace, for an unknown route with a malformed JSON body', async () => {
    const res = await request(app.getHttpServer())
      .post('/some-unknown-route')
      .set('Content-Type', 'application/json')
      .send('{ this is not valid json');

    expect(res.status).toBe(400);
    expect(res.body.errorCode).toBe('VALIDATION_ERROR');
    expect(res.body.requestId).toBeDefined();
    // No stack-trace-looking content (e.g. "at Object.<anonymous> (/path:12:34)") in the payload.
    expect(JSON.stringify(res.body)).not.toMatch(/at\s+\S+\s+\([^)]+:\d+:\d+\)/);
  });

  it('includes helmet security headers', async () => {
    const res = await request(app.getHttpServer()).get('/some-unknown-route');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-dns-prefetch-control']).toBeDefined();
  });
});
