import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { from, lastValueFrom, Observable } from 'rxjs';

import { getAuthContext } from '../security/auth-context.store';
import { CROSS_TENANT_KEY } from '../security/decorators/cross-tenant.decorator';

import { runWithTenantScope } from './tenant-context.store';

// Task 1.8 (arch §5 step 8, arch §8). Runs after JwtAuthGuard (step 5) in the
// guard pipeline (wired in Task 2.8 — not yet, per the plan's own note on
// this task). Builds a TenantScope from AuthContext.trainerId and publishes
// it to ALS for the rest of the request:
//
// - SUPER_ADMIN + @CrossTenant() on the route -> { kind: 'PLATFORM' }.
// - AuthContext.trainerId present (TRAINER or COACH) -> { kind: 'TRAINER', trainerId }.
// - Anything else (no AuthContext yet, or a role with no trainerId and no
//   @CrossTenant()) -> no scope is published at all. This is deliberate: a
//   SUPER_ADMIN route that forgot @CrossTenant() does NOT silently fall back
//   to PLATFORM — it gets no TenantScope, and arch §8 Layer 1 (every
//   tenant-owned repository method requires an explicit TenantScope
//   parameter, with no public PLATFORM constructor) is what forces that gap
//   to surface at the call site rather than here.
@Injectable()
export class TenantContextInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const authContext = getAuthContext();

    if (!authContext) {
      return next.handle();
    }

    const isCrossTenant = this.reflector.getAllAndOverride<boolean>(CROSS_TENANT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (authContext.role === 'SUPER_ADMIN' && isCrossTenant) {
      return from(runWithTenantScope({ kind: 'PLATFORM' }, () => lastValueFrom(next.handle())));
    }

    if (authContext.trainerId) {
      const trainerId = authContext.trainerId;
      return from(runWithTenantScope({ kind: 'TRAINER', trainerId }, () => lastValueFrom(next.handle())));
    }

    return next.handle();
  }
}
