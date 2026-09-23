import { JwtModule } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';

import { TokenService } from './token.service';

// Task 2.11 — pure JWT round-trip, no DB needed. A local JwtModule.register
// (not SecurityModule) keeps this test independent of shared/config's
// real JWT_SECRET.
describe('TokenService (Task 2.11)', () => {
  let service: TokenService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [JwtModule.register({ secret: 'test-secret', signOptions: { algorithm: 'HS256' } })],
      providers: [TokenService],
    }).compile();

    service = moduleRef.get(TokenService);
  });

  it('issues a token that round-trips through decode with all claims intact', async () => {
    const { accessToken, expiresIn } = await service.issueAccessToken({
      userId: 'user-1',
      role: 'PLAYER_PARENT',
      accountType: 'CHILD',
      guardianUserId: 'guardian-1',
      trainerId: 'trainer-1',
      tokenVersion: 3,
    });

    expect(expiresIn).toBe(900);

    const claims = await service.decode(accessToken);
    expect(claims).toMatchObject({
      sub: 'user-1',
      role: 'PLAYER_PARENT',
      typ: 'CHILD',
      gid: 'guardian-1',
      tid: 'trainer-1',
      tv: 3,
    });
    expect(claims.jti).toEqual(expect.any(String));
    expect(claims.act).toBeUndefined();
  });

  it('includes the act claim only when impersonation is passed', async () => {
    const { accessToken } = await service.issueAccessToken({
      userId: 'target-1',
      role: 'TRAINER',
      accountType: 'ADULT',
      tokenVersion: 0,
      impersonation: { actorUserId: 'admin-1', actorRole: 'SUPER_ADMIN', logId: 'log-1' },
    });

    const claims = await service.decode(accessToken);
    expect(claims.act).toEqual({ sub: 'admin-1', role: 'SUPER_ADMIN', imp: 'log-1' });
  });

  it('omits the act claim (not null) when there is no impersonation', async () => {
    const { accessToken } = await service.issueAccessToken({
      userId: 'user-1',
      role: 'TRAINER',
      accountType: 'ADULT',
      tokenVersion: 0,
    });

    const claims = await service.decode(accessToken);
    expect('act' in claims).toBe(false);
  });

  it('defaults gid/tid to null when not provided', async () => {
    const { accessToken } = await service.issueAccessToken({
      userId: 'user-1',
      role: 'SUPER_ADMIN',
      accountType: 'ADULT',
      tokenVersion: 0,
    });

    const claims = await service.decode(accessToken);
    expect(claims.gid).toBeNull();
    expect(claims.tid).toBeNull();
  });
});
