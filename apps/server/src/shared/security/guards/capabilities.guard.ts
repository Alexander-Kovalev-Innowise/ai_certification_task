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

// Task 7.5 (arch §10 "Blast radius"). Destructive Super-Admin capabilities
// blocked while impersonating, regardless of the effective role — defense
// in depth against an impersonated-trainer session being escalated. In
// practice, for every one of these three capabilities today the owning
// route ALSO carries `@Roles(SUPER_ADMIN)` (POST /impersonation/start,
// DELETE /users/:id, POST /trainers), and an impersonation token's
// effective role can never BE SUPER_ADMIN (assertNotTargetingSuperAdmin,
// Task 7.1) — so RolesGuard (pipeline step 6, before this guard's step 7)
// already rejects those three exact calls with a generic 403 FORBIDDEN
// before this check is ever reached (roles.guard.spec.ts's own "always uses
// the effective role, never the impersonation actor role" is precisely why).
// This block is still required exactly as specified: it is the actual,
// reachable authorization boundary for any future capability/route that
// requires one of these three but does NOT also carry a conflicting
// `@Roles(SUPER_ADMIN)` gate, and is unit-tested directly against this
// guard (capabilities.guard.spec.ts) rather than via those three routes'
// HTTP responses for that reason.
const IMPERSONATION_BLAST_RADIUS_CAPABILITIES: ReadonlySet<Capability> = new Set([
  Capability.IMPERSONATE_USER,
  Capability.GDPR_DELETE_USER,
  Capability.CREATE_TRAINER_ACCOUNT,
]);

// The one deliberate exception: `/impersonation/end` also requires
// `IMPERSONATE_USER` (api §2's endpoint table) but is BY DEFINITION only
// ever called while impersonating — it's the exit mechanism (Task 7.2).
// Without this exemption the block above would make it impossible to ever
// end a session through the API, leaving `ImpersonationMaintenanceJob`'s
// 10-minute sweep (Task 7.4) as the only way out.
const IMPERSONATION_END_PATH = '/impersonation/end';

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

    if (
      authContext?.impersonation &&
      request.path !== IMPERSONATION_END_PATH &&
      requiredCapabilities?.some((cap) => IMPERSONATION_BLAST_RADIUS_CAPABILITIES.has(cap))
    ) {
      throw new ForbiddenException({
        message: 'This action is not available while impersonating',
        errorCode: 'IMPERSONATION_NOT_ALLOWED',
      });
    }

    if (authContext?.accountType === 'CHILD' && requiredCapabilities?.some((cap) => CHILD_DENIED.has(cap))) {
      throw new ForbiddenException({ message: 'This action is not available to a child login', errorCode: 'CHILD_CAPABILITY_DENIED' });
    }

    if (authSnapshot?.mustChangePassword && !PASSWORD_CHANGE_EXEMPT_PATHS.has(request.path)) {
      throw new ForbiddenException({ message: 'Password change required before continuing', errorCode: 'PASSWORD_CHANGE_REQUIRED' });
    }

    return true;
  }
}
