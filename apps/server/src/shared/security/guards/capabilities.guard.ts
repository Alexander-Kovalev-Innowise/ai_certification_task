import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { CHILD_DENIED, Capability } from '../capability.enum';
import { REQUIRES_CAPABILITY_KEY } from '../decorators/requires-capability.decorator';

import type { AuthenticatedRequest } from './jwt-auth.guard';

// Task 2.6 (arch §6.6, §9.2). Runs after RolesGuard (step 7). Two
// responsibilities folded into one guard per the plan:
//
//   1. typ: CHILD hitting a deny-listed capability -> 403 CHILD_CAPABILITY_DENIED.
//   2. mustChangePassword: true blocking every route except the three exempt
//      ones -> 403 PASSWORD_CHANGE_REQUIRED.
//
// Exempt-route matching is by exact request path — the three routes named in
// arch §6.6 (/auth/change-password, /auth/logout, /me) take no path params,
// so this doesn't need full route-pattern matching.
const PASSWORD_CHANGE_EXEMPT_PATHS: ReadonlySet<string> = new Set([
  '/auth/change-password',
  '/auth/logout',
  '/me',
]);

@Injectable()
export class CapabilitiesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredCapabilities = this.reflector.getAllAndOverride<Capability[]>(REQUIRES_CAPABILITY_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authContext = request.authContext;
    const authSnapshot = request.authSnapshot;

    // TODO: wired fully in Task 7.5 once impersonation exists — the
    // blast-radius denial (IMPERSONATION_NOT_ALLOWED on
    // IMPERSONATE_USER/GDPR_DELETE_USER/CREATE_TRAINER_ACCOUNT while `act`
    // is present).

    if (authContext?.accountType === 'CHILD' && requiredCapabilities?.some((cap) => CHILD_DENIED.has(cap))) {
      throw new ForbiddenException({ message: 'This action is not available to a child login', errorCode: 'CHILD_CAPABILITY_DENIED' });
    }

    if (authSnapshot?.mustChangePassword && !PASSWORD_CHANGE_EXEMPT_PATHS.has(request.path)) {
      throw new ForbiddenException({ message: 'Password change required before continuing', errorCode: 'PASSWORD_CHANGE_REQUIRED' });
    }

    return true;
  }
}
