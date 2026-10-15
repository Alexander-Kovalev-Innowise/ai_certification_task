import { asUser } from './as-user.helper';

describe('asUser (Task 1.9)', () => {
  it('defaults to an ADULT claims object with a fresh sub/jti and no act claim', () => {
    const claims = asUser('TRAINER');

    expect(claims.role).toBe('TRAINER');
    expect(claims.typ).toBe('ADULT');
    expect(claims.gid).toBeNull();
    expect(claims.tid).toBeNull();
    expect(claims.tv).toBe(0);
    expect(claims.act).toBeUndefined();
    expect(claims.sub).toEqual(expect.any(String));
    expect(claims.jti).toEqual(expect.any(String));
    expect(claims.exp).toBeGreaterThan(claims.iat);
  });

  it('honors explicit options (trainerId, child account type, tokenVersion)', () => {
    const claims = asUser('COACH', {
      userId: 'coach-1',
      trainerId: 'trainer-1',
      accountType: 'CHILD',
      guardianUserId: 'guardian-1',
      tokenVersion: 3,
    });

    expect(claims).toMatchObject({
      sub: 'coach-1',
      role: 'COACH',
      typ: 'CHILD',
      gid: 'guardian-1',
      tid: 'trainer-1',
      tv: 3,
    });
  });

  it('sets the act claim when impersonation is provided', () => {
    const claims = asUser('TRAINER', {
      userId: 'target-user',
      impersonation: { actorUserId: 'admin-1', actorRole: 'SUPER_ADMIN', logId: 'log-1' },
    });

    expect(claims.act).toEqual({ sub: 'admin-1', role: 'SUPER_ADMIN', imp: 'log-1' });
  });
});
