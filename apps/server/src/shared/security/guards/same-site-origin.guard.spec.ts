import { ExecutionContext, ForbiddenException } from '@nestjs/common';

import { SameSiteOriginGuard } from './same-site-origin.guard';

function makeContext(headers: Record<string, string | undefined>): ExecutionContext {
  return { switchToHttp: () => ({ getRequest: () => ({ headers }) }) } as unknown as ExecutionContext;
}

describe('SameSiteOriginGuard (spec §13 CSRF, Origin verification)', () => {
  const guard = new SameSiteOriginGuard({ CLIENT_URL: 'http://localhost:3001' });

  function expectCsrfMismatch(headers: Record<string, string | undefined>) {
    try {
      guard.canActivate(makeContext(headers));
      throw new Error('expected the guard to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(ForbiddenException);
      expect((err as ForbiddenException).getResponse()).toMatchObject({ errorCode: 'CSRF_MISMATCH' });
    }
  }

  it('passes when Origin equals the client origin', () => {
    expect(guard.canActivate(makeContext({ origin: 'http://localhost:3001' }))).toBe(true);
  });

  it('rejects a different origin (host, port or scheme)', () => {
    expectCsrfMismatch({ origin: 'http://evil.example' });
    expectCsrfMismatch({ origin: 'http://localhost:3000' });
    expectCsrfMismatch({ origin: 'https://localhost:3001' });
    expectCsrfMismatch({ origin: 'http://localhost:3001.evil.example' });
  });

  it('rejects when neither Origin nor Referer is present', () => {
    expectCsrfMismatch({});
  });

  it('rejects the opaque Origin "null" and unparsable values', () => {
    expectCsrfMismatch({ origin: 'null' });
    expectCsrfMismatch({ origin: 'not a url' });
    expectCsrfMismatch({ origin: '' });
  });

  it('falls back to the Referer origin when Origin is absent', () => {
    expect(guard.canActivate(makeContext({ referer: 'http://localhost:3001/account?x=1' }))).toBe(true);
    expectCsrfMismatch({ referer: 'http://evil.example/http://localhost:3001/' });
  });

  it('does not fall back to a matching Referer when Origin is present but wrong', () => {
    expectCsrfMismatch({ origin: 'http://evil.example', referer: 'http://localhost:3001/' });
  });

  it('tolerates trailing slashes on either side', () => {
    expect(guard.canActivate(makeContext({ origin: 'http://localhost:3001/' }))).toBe(true);
    const slashConfigured = new SameSiteOriginGuard({ CLIENT_URL: 'http://localhost:3001/' });
    expect(slashConfigured.canActivate(makeContext({ origin: 'http://localhost:3001' }))).toBe(true);
  });

  it('rejects everything when CLIENT_URL itself is unparsable (fail closed)', () => {
    const broken = new SameSiteOriginGuard({ CLIENT_URL: '::nope::' });
    expect(() => broken.canActivate(makeContext({ origin: 'http://localhost:3001' }))).toThrow(ForbiddenException);
  });
});
