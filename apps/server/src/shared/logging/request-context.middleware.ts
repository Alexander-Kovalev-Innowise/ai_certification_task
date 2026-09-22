import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

export interface RequestContext {
  requestId: string;
  ip: string;
  userAgent: string;
}

// arch §5 step 2: publishes { requestId, ip, userAgent } into AsyncLocalStorage
// so any code later in the request's call stack (services, Prisma extensions,
// the pino logger) can read it without prop-drilling.
export const requestContextStorage = new AsyncLocalStorage<RequestContext>();

export function getRequestContext(): RequestContext | undefined {
  return requestContextStorage.getStore();
}

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction): void {
    const incomingRequestId = req.headers['x-request-id'];

    const context: RequestContext = {
      requestId: typeof incomingRequestId === 'string' ? incomingRequestId : randomUUID(),
      ip: req.ip ?? req.socket?.remoteAddress ?? 'unknown',
      userAgent: req.headers['user-agent'] ?? 'unknown',
    };

    requestContextStorage.run(context, () => next());
  }
}
