import { createHash, timingSafeEqual } from 'node:crypto';

import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { Request } from 'express';

import { CSRF_COOKIE } from '../../../modules/auth/session-cookies.util';

export const CSRF_HEADER = 'x-csrf-token';

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

/**
 * Spec §13 — layer 2, double-submit token (arch §6.4): the `X-CSRF-Token`
 * header must equal the (non-httpOnly) `csrf` cookie the browser attaches
 * automatically. The header value comes from the client's in-memory token
 * (returned in the login/refresh response body — page script on another
 * origin cannot read the API's cookie, see auth-session-response.dto.ts), so
 * a forged cross-site request, which can send the cookie but never knows the
 * token, fails. Only applied to routes that are reachable once a session
 * already exists (logout); /auth/refresh — the call that *mints* the token
 * after a page reload — is protected by SameSiteOriginGuard alone.
 *
 * Compared in constant time (both sides hashed first so differing lengths
 * leak nothing). Missing or mismatching => 403 CSRF_MISMATCH.
 */
@Injectable()
export class CsrfDoubleSubmitGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();

    const headerValue = request.headers[CSRF_HEADER];
    const cookieValue = (request.cookies as Record<string, unknown> | undefined)?.[CSRF_COOKIE];

    if (
      typeof headerValue !== 'string' ||
      typeof cookieValue !== 'string' ||
      headerValue.length === 0 ||
      cookieValue.length === 0 ||
      !timingSafeEqual(digest(headerValue), digest(cookieValue))
    ) {
      throw new ForbiddenException({
        message: 'CSRF token missing or does not match',
        errorCode: 'CSRF_MISMATCH',
      });
    }
    return true;
  }
}
