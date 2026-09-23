import type { Response } from 'express';

// arch §6.1/§6.4. Shared cookie-setting shape for every endpoint that
// establishes or rotates a session (login Task 2.13, refresh Task 2.14,
// trainer-setup auto-login Task 2.20).
export const REFRESH_TOKEN_COOKIE = 'refreshToken';
export const CSRF_COOKIE = 'csrf';
export const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export function setSessionCookies(res: Response, rawRefreshToken: string, csrfToken: string): void {
  const cookieOptions = {
    httpOnly: true,
    secure: true,
    sameSite: 'lax' as const,
    path: '/auth',
    maxAge: REFRESH_TOKEN_TTL_MS,
  };

  res.cookie(REFRESH_TOKEN_COOKIE, rawRefreshToken, cookieOptions);
  // Double-submit CSRF token — deliberately NOT httpOnly, so client JS can
  // read it and echo it back in X-CSRF-Token (arch §6.4).
  res.cookie(CSRF_COOKIE, csrfToken, { ...cookieOptions, httpOnly: false });
}

export function clearSessionCookies(res: Response): void {
  res.clearCookie(REFRESH_TOKEN_COOKIE, { path: '/auth' });
  res.clearCookie(CSRF_COOKIE, { path: '/auth' });
}
