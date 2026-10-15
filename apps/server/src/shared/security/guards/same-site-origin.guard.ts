import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import type { Request } from 'express';

import { ENV_CONFIG, type EnvConfig } from '../../config/config.module';

function toOrigin(value: string | undefined): string | null {
  if (!value) {
    return null;
  }
  try {
    // `new URL(...).origin` drops path, query and any trailing slash, and
    // yields the literal string "null" for opaque origins (Origin: null).
    const { origin } = new URL(value);
    return origin === 'null' ? null : origin;
  } catch {
    return null;
  }
}

/**
 * Spec §13 "CSRF protection on all state-changing operations" — layer 1,
 * OWASP's "verify origin with standard headers": a cookie-authenticated
 * state-changing request must carry an `Origin` header (falling back to the
 * `Referer`'s origin only when `Origin` is absent) equal to the configured
 * client origin — the very same single origin CORS allow-lists in main.ts
 * (`env.CLIENT_URL`). Browsers set these headers themselves and page script
 * cannot forge them, so a request forged from another site (or from an
 * attacker-controlled sub-origin) can never pass.
 *
 * Missing or mismatching => 403 CSRF_MISMATCH. Non-browser callers (curl,
 * server-to-server) that send neither header are rejected too: a route
 * guarded by this authenticates with an ambient cookie, which is exactly the
 * credential CSRF abuses, so there is no "trusted by default" caller.
 */
@Injectable()
export class SameSiteOriginGuard implements CanActivate {
  private readonly allowedOrigins: ReadonlySet<string>;

  constructor(@Inject(ENV_CONFIG) config: Pick<EnvConfig, 'CLIENT_URL'>) {
    const allowed = toOrigin(config.CLIENT_URL);
    this.allowedOrigins = new Set(allowed ? [allowed] : []);
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();

    const originHeader = request.headers.origin;
    // An `Origin` header, when present, is authoritative — do NOT fall back
    // to Referer if it is present-but-wrong (or the opaque "null").
    const requestOrigin =
      originHeader !== undefined ? toOrigin(originHeader) : toOrigin(request.headers.referer);

    if (!requestOrigin || !this.allowedOrigins.has(requestOrigin)) {
      throw new ForbiddenException({
        message: 'Cross-site request rejected: Origin does not match the application origin',
        errorCode: 'CSRF_MISMATCH',
      });
    }
    return true;
  }
}
