import { decodeAccessTokenPayload } from './decodeAccessToken';

function base64Url(value: object): string {
  return btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function makeToken(payload: object): string {
  return `${base64Url({ alg: 'HS256', typ: 'JWT' })}.${base64Url(payload)}.signature`;
}

// fe §5.1/api §2 — decodeAccessTokenPayload: a pure, display-only read of a
// JWT's payload segment (never verifies the signature — the server is the
// only party that does that, on every request). ImpersonationBanner (Task
// 16.1) uses the presence of the resulting `act` claim to decide whether to
// render, never a separate fetch.
describe('decodeAccessTokenPayload', () => {
  it('decodes sub/role/exp from a well-formed token', () => {
    const payload = decodeAccessTokenPayload(makeToken({ sub: 'trainer-7', role: 'TRAINER', exp: 1758549000 }));
    expect(payload).toEqual({ sub: 'trainer-7', role: 'TRAINER', exp: 1758549000 });
  });

  it('decodes the act claim when present (impersonation token, api §2)', () => {
    const payload = decodeAccessTokenPayload(
      makeToken({ sub: 'trainer-7', role: 'TRAINER', exp: 1758549000, act: { sub: 'admin-42', role: 'SUPER_ADMIN', imp: 'implog-99' } }),
    );
    expect(payload?.act).toEqual({ sub: 'admin-42', role: 'SUPER_ADMIN', imp: 'implog-99' });
  });

  it('returns null for a token with too few segments', () => {
    expect(decodeAccessTokenPayload('not-a-jwt')).toBeNull();
  });

  it('returns null for a payload segment that is not valid base64url JSON', () => {
    expect(decodeAccessTokenPayload('header.%%%not-base64%%%.signature')).toBeNull();
  });

  it('returns null when required claims are missing', () => {
    expect(decodeAccessTokenPayload(makeToken({ role: 'TRAINER', exp: 1758549000 }))).toBeNull();
  });

  it('never throws on malformed input', () => {
    expect(() => decodeAccessTokenPayload('')).not.toThrow();
    expect(decodeAccessTokenPayload('')).toBeNull();
  });
});
