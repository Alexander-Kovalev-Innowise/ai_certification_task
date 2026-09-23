import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';

import type { AccessTokenClaims } from '../access-token-claims.interface';
import { AuthSnapshotRepository } from '../auth-snapshot.repository';

import { AuthenticatedRequest, JwtAuthGuard } from './jwt-auth.guard';

function makeContext(request: Partial<AuthenticatedRequest>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => jest.fn(),
    getClass: () => jest.fn(),
  } as unknown as ExecutionContext;
}

const baseClaims: AccessTokenClaims = {
  sub: 'user-1',
  role: 'PLAYER_PARENT',
  typ: 'ADULT',
  gid: null,
  tid: null,
  tv: 0,
  jti: 'jti-1',
  iat: 0,
  exp: 9999999999,
};

describe('JwtAuthGuard (Task 2.4)', () => {
  let reflector: Reflector;
  let jwtService: jest.Mocked<Pick<JwtService, 'verifyAsync'>>;
  let authSnapshotRepository: jest.Mocked<Pick<AuthSnapshotRepository, 'findForAuth'>>;
  let guard: JwtAuthGuard;

  beforeEach(() => {
    reflector = new Reflector();
    jwtService = { verifyAsync: jest.fn() };
    authSnapshotRepository = { findForAuth: jest.fn() };
    guard = new JwtAuthGuard(
      reflector,
      jwtService as unknown as JwtService,
      authSnapshotRepository as unknown as AuthSnapshotRepository,
    );
  });

  it('skips authentication entirely for a @Public() route', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);
    const request: Partial<AuthenticatedRequest> = { headers: {} };

    await expect(guard.canActivate(makeContext(request))).resolves.toBe(true);
    expect(jwtService.verifyAsync).not.toHaveBeenCalled();
  });

  it('rejects a request with no Authorization header', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    const request: Partial<AuthenticatedRequest> = { headers: {} };

    await expect(guard.canActivate(makeContext(request))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects an invalid/expired token with errorCode UNAUTHORIZED', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    jwtService.verifyAsync.mockRejectedValue(new Error('bad token'));
    const request: Partial<AuthenticatedRequest> = { headers: { authorization: 'Bearer bad.token.here' } };

    try {
      await guard.canActivate(makeContext(request));
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(UnauthorizedException);
      expect((err as UnauthorizedException).getResponse()).toMatchObject({ errorCode: 'UNAUTHORIZED' });
    }
  });

  it('rejects when the auth-snapshot row is missing (proves the guard checks the row, not just the token)', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    jwtService.verifyAsync.mockResolvedValue(baseClaims);
    authSnapshotRepository.findForAuth.mockResolvedValue(null);
    const request: Partial<AuthenticatedRequest> = { headers: { authorization: 'Bearer valid' } };

    try {
      await guard.canActivate(makeContext(request));
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(UnauthorizedException);
      expect((err as UnauthorizedException).getResponse()).toMatchObject({ errorCode: 'ACCOUNT_INACTIVE' });
    }
  });

  it.each(['INACTIVE', 'DELETED'] as const)('rejects a %s user with errorCode ACCOUNT_INACTIVE, not a not-found shape', async (status) => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    jwtService.verifyAsync.mockResolvedValue(baseClaims);
    authSnapshotRepository.findForAuth.mockResolvedValue({
      id: 'user-1',
      status,
      role: 'PLAYER_PARENT',
      tokenVersion: 0,
      mustChangePassword: false,
    });
    const request: Partial<AuthenticatedRequest> = { headers: { authorization: 'Bearer valid' } };

    try {
      await guard.canActivate(makeContext(request));
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(UnauthorizedException);
      expect((err as UnauthorizedException).getResponse()).toMatchObject({ errorCode: 'ACCOUNT_INACTIVE' });
    }
  });

  it('rejects when payload.tv no longer matches row.tokenVersion (revocation)', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    jwtService.verifyAsync.mockResolvedValue({ ...baseClaims, tv: 1 });
    authSnapshotRepository.findForAuth.mockResolvedValue({
      id: 'user-1',
      status: 'ACTIVE',
      role: 'PLAYER_PARENT',
      tokenVersion: 2,
      mustChangePassword: false,
    });
    const request: Partial<AuthenticatedRequest> = { headers: { authorization: 'Bearer valid' } };

    await expect(guard.canActivate(makeContext(request))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('builds AuthContext, memoizes it on the request, and publishes it to ALS', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    jwtService.verifyAsync.mockResolvedValue({
      ...baseClaims,
      role: 'PLAYER_PARENT',
      typ: 'CHILD',
      gid: 'guardian-1',
      tid: 'trainer-1',
      act: { sub: 'admin-1', role: 'SUPER_ADMIN', imp: 'log-1' },
    });
    authSnapshotRepository.findForAuth.mockResolvedValue({
      id: 'user-1',
      status: 'ACTIVE',
      role: 'PLAYER_PARENT',
      tokenVersion: 0,
      mustChangePassword: true,
    });
    const request: Partial<AuthenticatedRequest> = { headers: { authorization: 'Bearer valid' } };

    await guard.canActivate(makeContext(request));

    expect(request.authContext).toMatchObject({
      userId: 'user-1',
      role: 'PLAYER_PARENT',
      accountType: 'CHILD',
      guardianUserId: 'guardian-1',
      trainerId: 'trainer-1',
      auditActorId: 'admin-1',
    });
    expect(request.authContext?.impersonation).toMatchObject({
      actorUserId: 'admin-1',
      actorRole: 'SUPER_ADMIN',
      logId: 'log-1',
    });
    expect(request.authSnapshot).toMatchObject({ mustChangePassword: true });
  });

  it('does not call findForAuth a second time once memoized on the request', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    const authContext = { userId: 'user-1' } as AuthenticatedRequest['authContext'];
    const authSnapshot = { id: 'user-1' } as AuthenticatedRequest['authSnapshot'];
    const request: Partial<AuthenticatedRequest> = {
      headers: { authorization: 'Bearer valid' },
      authContext,
      authSnapshot,
    };

    await expect(guard.canActivate(makeContext(request))).resolves.toBe(true);
    expect(authSnapshotRepository.findForAuth).not.toHaveBeenCalled();
    expect(jwtService.verifyAsync).not.toHaveBeenCalled();
  });
});
