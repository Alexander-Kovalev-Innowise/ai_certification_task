import type { Request, Response } from 'express';

import { RequestContextMiddleware, getRequestContext } from './request-context.middleware';

function makeReq(overrides: Partial<Request> = {}): Request {
  return {
    headers: {},
    ip: '127.0.0.1',
    socket: { remoteAddress: '127.0.0.1' },
    ...overrides,
  } as unknown as Request;
}

describe('RequestContextMiddleware', () => {
  const middleware = new RequestContextMiddleware();

  it('publishes requestId/ip/userAgent to ALS, readable inside next()', () => {
    const req = makeReq({ headers: { 'user-agent': 'jest-test' } });

    expect.assertions(3);
    middleware.use(req, {} as Response, () => {
      const ctx = getRequestContext();
      expect(ctx?.requestId).toEqual(expect.any(String));
      expect(ctx?.userAgent).toBe('jest-test');
      expect(ctx?.ip).toBe('127.0.0.1');
    });
  });

  it('reuses an incoming x-request-id header instead of generating a new one', () => {
    const req = makeReq({ headers: { 'x-request-id': 'fixed-id-123' } });

    expect.assertions(1);
    middleware.use(req, {} as Response, () => {
      expect(getRequestContext()?.requestId).toBe('fixed-id-123');
    });
  });

  it('returns undefined outside of any middleware-published context', () => {
    expect(getRequestContext()).toBeUndefined();
  });

  it('isolates requestId between two concurrent requests', async () => {
    const seen: Record<string, string | undefined> = {};

    function simulateRequest(label: string, delayMs: number): Promise<void> {
      return new Promise((resolve) => {
        const req = makeReq({ headers: {} });
        middleware.use(req, {} as Response, () => {
          const ctxAtStart = getRequestContext()?.requestId;
          setTimeout(() => {
            // Still sees its own requestId after an async gap — proves the
            // ALS store isn't leaking between concurrently in-flight requests.
            seen[label] = getRequestContext()?.requestId;
            expect(seen[label]).toBe(ctxAtStart);
            resolve();
          }, delayMs);
        });
      });
    }

    await Promise.all([simulateRequest('A', 20), simulateRequest('B', 5)]);

    expect(seen.A).toBeDefined();
    expect(seen.B).toBeDefined();
    expect(seen.A).not.toBe(seen.B);
  });
});
