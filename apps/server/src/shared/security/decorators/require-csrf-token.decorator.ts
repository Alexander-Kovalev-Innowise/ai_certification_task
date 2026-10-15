import { applyDecorators, UseGuards } from '@nestjs/common';
import { ApiHeader, ApiResponse } from '@nestjs/swagger';

import { CsrfDoubleSubmitGuard } from '../guards/csrf-double-submit.guard';

/**
 * Double-submit CSRF token on top of RequireSameSiteOrigin: `X-CSRF-Token`
 * must equal the `csrf` cookie. For cookie-authenticated routes that are only
 * reachable after a session exists (the client already holds the token from
 * login/refresh).
 */
export const RequireCsrfToken = () =>
  applyDecorators(
    UseGuards(CsrfDoubleSubmitGuard),
    ApiHeader({
      name: 'X-CSRF-Token',
      required: true,
      description: 'Must equal the `csrf` cookie value (the csrfToken returned by login/refresh).',
    }),
    ApiResponse({
      status: 403,
      description: 'X-CSRF-Token missing or not equal to the csrf cookie',
      schema: { example: { errorCode: 'CSRF_MISMATCH' } },
    }),
  );
