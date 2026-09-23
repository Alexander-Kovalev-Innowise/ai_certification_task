import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

import type { AuthContext } from '../auth-context.interface';

// Task 2.3 (arch §7.1). Reads the AuthContext JwtAuthGuard (Task 2.4)
// attached to the request object (the guard's per-request memoization — the
// same object it publishes to ALS). Undefined on @Public() routes that have
// no authenticated caller.
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthContext | undefined => {
  const request = ctx.switchToHttp().getRequest<Request & { authContext?: AuthContext }>();
  return request.authContext;
});
