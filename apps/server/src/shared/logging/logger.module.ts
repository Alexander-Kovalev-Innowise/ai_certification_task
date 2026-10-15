import { randomUUID } from 'node:crypto';

import { Module } from '@nestjs/common';
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino';

import { getRequestContext } from './request-context.middleware';

// PII-redaction: password/passwordHash/token fields (and common variants) are
// never written to logs, on request bodies or response bodies.
const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.body.password',
  'req.body.passwordHash',
  'req.body.newPassword',
  'req.body.currentPassword',
  'req.body.token',
  'req.body.refreshToken',
  'req.body.accessToken',
  'res.body.password',
  'res.body.passwordHash',
  'res.body.token',
];

@Module({
  imports: [
    PinoLoggerModule.forRoot({
      pinoHttp: {
        // Prefers the correlation id already published by
        // RequestContextMiddleware (Task 0.9) when it has run first in the
        // pipeline; otherwise mints a fresh one so logging never breaks on
        // its own.
        genReqId: (req) => {
          const existing = getRequestContext()?.requestId;
          if (existing) return existing;
          const header = req.headers['x-request-id'];
          return typeof header === 'string' ? header : randomUUID();
        },
        redact: {
          paths: REDACT_PATHS,
          censor: '[REDACTED]',
        },
        autoLogging: true,
      },
    }),
  ],
  exports: [PinoLoggerModule],
})
export class LoggerModule {}
