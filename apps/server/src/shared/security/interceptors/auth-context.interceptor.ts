import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { from, lastValueFrom, Observable } from 'rxjs';

import { runWithAuthContext } from '../auth-context.store';
import type { AuthenticatedRequest } from '../guards/jwt-auth.guard';

// Not one of Task 2.4's two named files — added as part of it (see the long
// comment in jwt-auth.guard.ts for why `enterWith` inside the guard itself
// doesn't work). This is what actually fulfils "JwtAuthGuard... publishes
// [AuthContext] to the ALS store... before any later pipeline step runs"
// (Task 2.2/2.4): it reads the AuthContext the guard already memoized on the
// request object and wraps the rest of the pipeline (TenantContextInterceptor
// downstream, then Controller → Service → Repository → PrismaService, where
// the tenant-guard and audit-stamp extensions read it from ALS) in
// `runWithAuthContext`. Registered as APP_INTERCEPTOR immediately before
// TenantContextInterceptor (Task 2.8) — same `from(...lastValueFrom...)`
// wrapping pattern TenantContextInterceptor already uses, and for the same
// reason (tenant-context.store.ts's comment on why a lazy Prisma thenable
// needs the *entire* async callback, not just its synchronous portion,
// inside AsyncLocalStorage's `run` scope).
@Injectable()
export class AuthContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    if (!request.authContext) {
      return next.handle();
    }

    return from(runWithAuthContext(request.authContext, () => lastValueFrom(next.handle())));
  }
}
