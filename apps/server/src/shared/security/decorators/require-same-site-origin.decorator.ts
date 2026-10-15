import { applyDecorators, UseGuards } from '@nestjs/common';
import { ApiHeader, ApiResponse } from '@nestjs/swagger';

import { SameSiteOriginGuard } from '../guards/same-site-origin.guard';

/**
 * Marks a cookie-authenticated, state-changing route as requiring a trusted
 * `Origin` (or `Referer`) header — see SameSiteOriginGuard. Apply to every
 * route that authenticates via the refresh cookie (spec §13 CSRF).
 */
export const RequireSameSiteOrigin = () =>
  applyDecorators(
    UseGuards(SameSiteOriginGuard),
    ApiHeader({
      name: 'Origin',
      required: true,
      description:
        'Must equal the configured client origin (CLIENT_URL). Browsers send it automatically; non-browser callers ' +
        'without an Origin/Referer header are rejected because this route authenticates with a cookie.',
    }),
    ApiResponse({
      status: 403,
      description: 'Origin missing or not the application origin',
      schema: { example: { errorCode: 'CSRF_MISMATCH' } },
    }),
  );
