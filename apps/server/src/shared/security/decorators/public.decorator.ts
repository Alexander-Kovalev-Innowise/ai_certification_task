import { SetMetadata } from '@nestjs/common';

// Task 2.3 (arch §7.1). Read by JwtAuthGuard (Task 2.4) to skip authentication
// entirely for a route (login, refresh, forgot-password, share-link preview,
// etc.). Default posture is deny — a route with no @Public() requires a
// valid token.
export const IS_PUBLIC_KEY = 'isPublic';

export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
