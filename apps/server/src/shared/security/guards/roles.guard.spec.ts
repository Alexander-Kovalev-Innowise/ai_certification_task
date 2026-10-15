import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import type { AuthContext } from '../auth-context.interface';

import type { AuthenticatedRequest } from './jwt-auth.guard';
import { RolesGuard } from './roles.guard';

function makeContext(request: Partial<AuthenticatedRequest>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => jest.fn(),
    getClass: () => jest.fn(),
  } as unknown as ExecutionContext;
}

describe('RolesGuard (Task 2.5)', () => {
  let reflector: Reflector;
  let guard: RolesGuard;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new RolesGuard(reflector);
  });

  it('passes when the effective role matches one of the required roles', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['TRAINER', 'SUPER_ADMIN']);
    const authContext = { role: 'TRAINER' } as AuthContext;

    expect(guard.canActivate(makeContext({ authContext }))).toBe(true);
  });

  it('rejects with 403 FORBIDDEN when the effective role does not match', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['TRAINER']);
    const authContext = { role: 'PLAYER_PARENT' } as AuthContext;

    expect(() => guard.canActivate(makeContext({ authContext }))).toThrow(ForbiddenException);
  });

  it('always uses the effective role (sub/role), never the impersonation actor role', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['PLAYER_PARENT']);
    const authContext = {
      role: 'PLAYER_PARENT',
      impersonation: { actorUserId: 'admin-1', actorRole: 'SUPER_ADMIN', logId: 'log-1', expiresAt: new Date() },
    } as AuthContext;

    expect(guard.canActivate(makeContext({ authContext }))).toBe(true);
  });

  it('passes any authenticated role when no @Roles() metadata is present', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
    const authContext = { role: 'PLAYER_PARENT' } as AuthContext;

    expect(guard.canActivate(makeContext({ authContext }))).toBe(true);
  });
});
