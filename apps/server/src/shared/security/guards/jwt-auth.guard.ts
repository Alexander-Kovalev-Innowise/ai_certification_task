import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';

import { env } from '../../config/config.module';
import type { AccessTokenClaims } from '../access-token-claims.interface';
import type { AuthContext } from '../auth-context.interface';
import { AuthSnapshot, AuthSnapshotRepository } from '../auth-snapshot.repository';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

// Augment express.Request with the two fields this guard memoizes per
// request (Task 2.4 point 4): the typed AuthContext every later layer reads,
// and the raw auth snapshot row (status/tokenVersion/mustChangePassword)
// CapabilitiesGuard (Task 2.6) needs but which isn't part of the AuthContext
// shape (arch §7.2).
export interface AuthenticatedRequest extends Request {
  authContext?: AuthContext;
  authSnapshot?: AuthSnapshot;
}

function buildAuthContext(claims: AccessTokenClaims): AuthContext {
  const impersonation = claims.act
    ? {
        actorUserId: claims.act.sub,
        actorRole: claims.act.role,
        logId: claims.act.imp,
        expiresAt: new Date(claims.exp * 1000),
      }
    : undefined;

  return {
    userId: claims.sub,
    role: claims.role,
    accountType: claims.typ,
    guardianUserId: claims.gid ?? undefined,
    trainerId: claims.tid ?? undefined,
    impersonation,
    auditActorId: impersonation?.actorUserId ?? claims.sub,
  };
}

// Task 2.4 — the structural-surprise task (arch §6.3, §5 step 5).
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwtService: JwtService,
    private readonly authSnapshotRepository: AuthSnapshotRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    // Already resolved earlier in this same request (point 4 — memoized per
    // request, never across requests).
    if (request.authContext && request.authSnapshot) {
      return true;
    }

    const token = this.extractBearerToken(request);
    if (!token) {
      throw new UnauthorizedException({ message: 'Missing or malformed Authorization header', errorCode: 'UNAUTHORIZED' });
    }

    let claims: AccessTokenClaims;
    try {
      claims = await this.jwtService.verifyAsync<AccessTokenClaims>(token, { secret: env.JWT_SECRET });
    } catch {
      throw new UnauthorizedException({ message: 'Invalid or expired access token', errorCode: 'UNAUTHORIZED' });
    }

    // The guard's own indexed User read — MUST be findUnique (see
    // auth-snapshot.repository.ts). Runs before any TenantScope exists in
    // ALS (pipeline position 5, before TenantContextInterceptor at 8), and
    // `User` isn't in the tenant-owned model set anyway — two independent
    // reasons the tenant-guard extension has nothing to check yet here.
    const row = await this.authSnapshotRepository.findForAuth(claims.sub);

    if (!row || row.status !== 'ACTIVE' || claims.tv !== row.tokenVersion) {
      throw new UnauthorizedException({ message: 'Account is inactive or session has been revoked', errorCode: 'ACCOUNT_INACTIVE' });
    }

    const authContext = buildAuthContext(claims);

    // Memoized on the request object — read directly by RolesGuard (Task
    // 2.5), CapabilitiesGuard (Task 2.6, needs authSnapshot.mustChangePassword
    // too), and the @CurrentUser() param decorator (Task 2.3). This is NOT
    // published to AsyncLocalStorage from here: `AsyncLocalStorage#enterWith`
    // called after an `await` inside an async function does not reliably
    // propagate to the *caller's* continuation once that function returns
    // (verified empirically — Nest's internal guard runner does
    // `await guard.canActivate(...)`, and a store entered post-await inside
    // canActivate is not visible in the code that resumes after that await,
    // even though it IS visible to anything canActivate itself schedules
    // before returning). Since this guard's AuthContext can only be known
    // after two awaited calls (JWT verify, the DB read above), `enterWith`
    // here would silently fail to reach RolesGuard/CapabilitiesGuard or the
    // controller/service/repository layer.
    //
    // The actual ALS publish — matching this task's stated goal ("published
    // by JwtAuthGuard... before any later pipeline step runs") — happens in
    // AuthContextInterceptor (../interceptors/auth-context.interceptor.ts),
    // which reads `request.authContext` (set here) and wraps
    // `next.handle()` in `runWithAuthContext(...)`, the same proven pattern
    // TenantContextInterceptor already uses for TenantScope. Interceptors
    // DO have a "wrap everything downstream" hook (`next.handle()`), which
    // is exactly what a CanActivate guard lacks — so the publish step moves
    // there, registered immediately before TenantContextInterceptor in the
    // pipeline (Task 2.8), while this guard remains the sole place that
    // *resolves* AuthContext from the token + DB read.
    request.authContext = authContext;
    request.authSnapshot = row;

    return true;
  }

  private extractBearerToken(request: Request): string | undefined {
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      return undefined;
    }
    return header.slice('Bearer '.length).trim() || undefined;
  }
}
