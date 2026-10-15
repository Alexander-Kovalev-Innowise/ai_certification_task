import { ExecutionContext, ForbiddenException } from '@nestjs/common';

import { CsrfDoubleSubmitGuard } from './csrf-double-submit.guard';

function makeContext(headers: Record<string, string | string[] | undefined>, cookies?: Record<string, unknown>): ExecutionContext {
  return { switchToHttp: () => ({ getRequest: () => ({ headers, cookies }) }) } as unknown as ExecutionContext;
}

describe('CsrfDoubleSubmitGuard (spec §13 CSRF, double-submit token)', () => {
  const guard = new CsrfDoubleSubmitGuard();

  function expectCsrfMismatch(ctx: ExecutionContext) {
    try {
      guard.canActivate(ctx);
      throw new Error('expected the guard to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(ForbiddenException);
      expect((err as ForbiddenException).getResponse()).toMatchObject({ errorCode: 'CSRF_MISMATCH' });
    }
  }

  it('passes when the header equals the csrf cookie', () => {
    expect(guard.canActivate(makeContext({ 'x-csrf-token': 'abc123' }, { csrf: 'abc123' }))).toBe(true);
  });

  it('rejects a different header value', () => {
    expectCsrfMismatch(makeContext({ 'x-csrf-token': 'abc124' }, { csrf: 'abc123' }));
    expectCsrfMismatch(makeContext({ 'x-csrf-token': 'abc' }, { csrf: 'abc123' }));
  });

  it('rejects a missing header, missing cookie, or no cookie-parser output at all', () => {
    expectCsrfMismatch(makeContext({}, { csrf: 'abc123' }));
    expectCsrfMismatch(makeContext({ 'x-csrf-token': 'abc123' }, {}));
    expectCsrfMismatch(makeContext({ 'x-csrf-token': 'abc123' }, undefined));
  });

  it('rejects empty values on both sides (empty === empty must not pass)', () => {
    expectCsrfMismatch(makeContext({ 'x-csrf-token': '' }, { csrf: '' }));
  });

  it('rejects a repeated header (array) and non-string cookie values', () => {
    expectCsrfMismatch(makeContext({ 'x-csrf-token': ['abc123', 'abc123'] }, { csrf: 'abc123' }));
    expectCsrfMismatch(makeContext({ 'x-csrf-token': 'abc123' }, { csrf: { toString: () => 'abc123' } }));
  });
});
