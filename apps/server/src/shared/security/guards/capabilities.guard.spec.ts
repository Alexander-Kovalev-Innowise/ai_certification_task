import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import type { AuthContext } from '../auth-context.interface';
import { Capability } from '../capability.enum';

import { CapabilitiesGuard } from './capabilities.guard';
import type { AuthenticatedRequest } from './jwt-auth.guard';

function makeContext(request: Partial<AuthenticatedRequest>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => jest.fn(),
    getClass: () => jest.fn(),
  } as unknown as ExecutionContext;
}

describe('CapabilitiesGuard (Task 2.6)', () => {
  let reflector: Reflector;
  let guard: CapabilitiesGuard;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new CapabilitiesGuard(reflector);
  });

  it('rejects a CHILD token hitting a deny-listed capability with 403 CHILD_CAPABILITY_DENIED', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([Capability.MANAGE_TRAINER_ASSOCIATIONS]);
    const authContext = { accountType: 'CHILD' } as AuthContext;
    const request: Partial<AuthenticatedRequest> = { authContext, path: '/associations' };

    try {
      guard.canActivate(makeContext(request));
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ForbiddenException);
      expect((err as ForbiddenException).getResponse()).toMatchObject({ errorCode: 'CHILD_CAPABILITY_DENIED' });
    }
  });

  it('allows a CHILD token hitting a non-deny-listed capability', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([Capability.EDIT_OWN_PROFILE]);
    const authContext = { accountType: 'CHILD' } as AuthContext;
    const request: Partial<AuthenticatedRequest> = { authContext, path: '/me' };

    expect(guard.canActivate(makeContext(request))).toBe(true);
  });

  it('blocks a non-exempt route with 403 PASSWORD_CHANGE_REQUIRED when mustChangePassword is true', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([Capability.VIEW_PLAYER_AVAILABILITY]);
    const authContext = { accountType: 'ADULT' } as AuthContext;
    const request: Partial<AuthenticatedRequest> = {
      authContext,
      authSnapshot: { mustChangePassword: true } as AuthenticatedRequest['authSnapshot'],
      path: '/player-profiles',
    };

    try {
      guard.canActivate(makeContext(request));
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ForbiddenException);
      expect((err as ForbiddenException).getResponse()).toMatchObject({ errorCode: 'PASSWORD_CHANGE_REQUIRED' });
    }
  });

  it.each(['/auth/change-password', '/auth/logout', '/me'])(
    'lets the exempt route %s through even when mustChangePassword is true',
    (path) => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([Capability.EDIT_OWN_PROFILE]);
      const authContext = { accountType: 'ADULT' } as AuthContext;
      const request: Partial<AuthenticatedRequest> = {
        authContext,
        authSnapshot: { mustChangePassword: true } as AuthenticatedRequest['authSnapshot'],
        path,
      };

      expect(guard.canActivate(makeContext(request))).toBe(true);
    },
  );

  it('allows a normal request with no CHILD deny-list hit and no forced password change', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue([Capability.EDIT_OWN_PROFILE]);
    const authContext = { accountType: 'ADULT' } as AuthContext;
    const request: Partial<AuthenticatedRequest> = {
      authContext,
      authSnapshot: { mustChangePassword: false } as AuthenticatedRequest['authSnapshot'],
      path: '/me',
    };

    expect(guard.canActivate(makeContext(request))).toBe(true);
  });
});
