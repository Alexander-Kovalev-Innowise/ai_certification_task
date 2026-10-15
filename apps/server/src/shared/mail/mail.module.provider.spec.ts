import { Controller, INestApplication, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

type EnvOverrides = {
  NODE_ENV: string;
  MAIL_PROVIDER: string;
  SMTP_URL?: string;
  MAIL_FROM?: string;
};

// MailModule reads `env` at import time (decorator metadata), so each case
// loads a fresh module graph against a mocked config module.
async function loadMailModule(env: EnvOverrides) {
  jest.resetModules();
  jest.doMock('../config/config.module', () => ({ env: { CLIENT_URL: 'http://localhost:3001', ...env } }));
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { MailModule } = require('./mail.module') as typeof import('./mail.module');
  const { MailService } = require('./mail.service') as typeof import('./mail.service');
  const adapters = {
    Console: (require('./adapters/console-mail.adapter') as typeof import('./adapters/console-mail.adapter')).ConsoleMailAdapter,
    Dev: (require('./adapters/dev-mail.adapter') as typeof import('./adapters/dev-mail.adapter')).DevMailAdapter,
    Smtp: (require('./adapters/smtp-mail.adapter') as typeof import('./adapters/smtp-mail.adapter')).SmtpMailAdapter,
  };
  /* eslint-enable @typescript-eslint/no-require-imports */
  return { MailModule, MailService, adapters };
}

describe('MailModule provider selection', () => {
  afterEach(() => {
    jest.dontMock('../config/config.module');
    jest.resetModules();
  });

  it('smtp -> SmtpMailAdapter', async () => {
    const { MailModule, MailService, adapters } = await loadMailModule({
      NODE_ENV: 'test',
      MAIL_PROVIDER: 'smtp',
      SMTP_URL: 'smtp://localhost:1025',
      MAIL_FROM: 'no-reply@example.com',
    });
    const ref = await Test.createTestingModule({ imports: [MailModule] }).compile();
    expect(ref.get(MailService)).toBeInstanceOf(adapters.Smtp);
  });

  it('console -> ConsoleMailAdapter and no dev mailbox route', async () => {
    const { MailModule, MailService, adapters } = await loadMailModule({ NODE_ENV: 'test', MAIL_PROVIDER: 'console' });
    const ref = await Test.createTestingModule({ imports: [MailModule] }).compile();
    expect(ref.get(MailService)).toBeInstanceOf(adapters.Console);
    expect(Reflect.getMetadata('controllers', MailModule) ?? []).toHaveLength(0);
  });

  it('dev in production -> falls back to console and registers NO controller', async () => {
    const { MailModule, MailService, adapters } = await loadMailModule({ NODE_ENV: 'production', MAIL_PROVIDER: 'dev' });
    const ref = await Test.createTestingModule({ imports: [MailModule] }).compile();
    expect(ref.get(MailService)).toBeInstanceOf(adapters.Console);
    expect(Reflect.getMetadata('controllers', MailModule) ?? []).toHaveLength(0);
  });
});

describe('Dev mailbox endpoints (MAIL_PROVIDER=dev, non-production)', () => {
  let app: INestApplication;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamically required
  let mail: any;

  beforeAll(async () => {
    const { MailModule, MailService } = await loadMailModule({ NODE_ENV: 'test', MAIL_PROVIDER: 'dev' });

    @Controller()
    class Noop {}
    @Module({ imports: [MailModule], controllers: [Noop] })
    class TestAppModule {}

    const ref = await Test.createTestingModule({ imports: [TestAppModule] }).compile();
    app = ref.createNestApplication();
    await app.init();
    mail = ref.get(MailService);
  });

  afterAll(async () => {
    await app.close();
    jest.dontMock('../config/config.module');
    jest.resetModules();
  });

  it('GET lists mails (newest last, filtered by ?to=) and DELETE clears', async () => {
    await mail.send({ to: 'a@x.com', subject: 'one', html: '<a href="http://l/1">x</a>', text: 'x', links: ['http://l/1'], templateId: 'EMAIL_VERIFICATION' });
    await mail.send({ to: 'b@x.com', subject: 'two' });
    await mail.send({ to: 'a@x.com', subject: 'three' });

    const all = await request(app.getHttpServer()).get('/__dev/mailbox').expect(200);
    expect(all.body.map((m: { subject: string }) => m.subject)).toEqual(['one', 'two', 'three']);

    const forA = await request(app.getHttpServer()).get('/__dev/mailbox').query({ to: 'a@x.com' }).expect(200);
    expect(forA.body).toHaveLength(2);
    expect(forA.body[0]).toEqual(
      expect.objectContaining({
        to: 'a@x.com',
        subject: 'one',
        templateId: 'EMAIL_VERIFICATION',
        links: ['http://l/1'],
        html: expect.any(String),
        text: 'x',
        sentAt: expect.any(String),
      }),
    );

    await request(app.getHttpServer()).delete('/__dev/mailbox').expect(204);
    const after = await request(app.getHttpServer()).get('/__dev/mailbox').expect(200);
    expect(after.body).toEqual([]);
  });
});

describe('Dev mailbox endpoints do not exist otherwise', () => {
  it.each([
    ['console', 'test'],
    ['dev', 'production'],
  ])('MAIL_PROVIDER=%s NODE_ENV=%s -> 404', async (provider, nodeEnv) => {
    const { MailModule } = await loadMailModule({ NODE_ENV: nodeEnv, MAIL_PROVIDER: provider });
    @Controller()
    class Noop {}
    @Module({ imports: [MailModule], controllers: [Noop] })
    class TestAppModule {}
    const ref = await Test.createTestingModule({ imports: [TestAppModule] }).compile();
    const app = ref.createNestApplication();
    await app.init();
    try {
      await request(app.getHttpServer()).get('/__dev/mailbox').expect(404);
      await request(app.getHttpServer()).delete('/__dev/mailbox').expect(404);
    } finally {
      await app.close();
      jest.dontMock('../config/config.module');
      jest.resetModules();
    }
  });
});
