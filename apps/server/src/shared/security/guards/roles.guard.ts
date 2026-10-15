import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Role } from '@prisma/client';

import { ROLES_KEY } from '../decorators/roles.decorator';

import type { AuthenticatedRequest } from './jwt-auth.guard';

// Task 2.5 (arch §5 step 6, §7.1). Runs after JwtAuthGuard (step 5), reading
// the AuthContext the guard already memoized on the request object — same
// request-object handoff JwtAuthGuard documents, not ALS (guards don't have
// a reliable ALS-publish point of their own; see jwt-auth.guard.ts).
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // No @Roles() metadata -> available to any authenticated role (still
    // subject to tenancy/capability checks downstream, arch §7.1).
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const effectiveRole = request.authContext?.role;

    if (!effectiveRole || !requiredRoles.includes(effectiveRole)) {
      throw new ForbiddenException({ message: 'Insufficient role', errorCode: 'FORBIDDEN' });
    }

    return true;
  }
}
