
import { useAuthStore } from '../../stores/useAuthStore';
import { useTrainerContextStore } from '../../stores/useTrainerContextStore';
import type { AuthSessionResponseDto } from '../../types/auth';
import { logClientError } from '../monitoring/errorMonitor';
import { toast } from '../toast/toast';

import { parseApiErrorBody } from './apiError';

// arch §1: apps/client never talks to Postgres directly — every call here
// goes to the NestJS API over HTTP, base URL injected at build time via
// next.config.mjs's root-.env loader (Task 0.5).
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? '';

// Double-submit CSRF cookie name (session-cookies.util.ts's CSRF_COOKIE,
// mirrored here — non-httpOnly by server design specifically so client JS
// can read and echo it, arch §6.4).
const CSRF_COOKIE = 'csrf';

export class SessionExpiredError extends Error {
  constructor() {
    super('Session expired');
    this.name = 'SessionExpiredError';
  }
}

/**
 * fe §9.4/Task 18.3 — thrown by apiRequest() for a `500
 * TENANT_SCOPE_VIOLATION` (architecture §8 Layer 2: should never reach the
 * client, must degrade safely if it does). `QueryProvider.tsx` configures
 * TanStack Query's `throwOnError` to re-throw exactly this type during
 * render, so the root `ErrorBoundary` (Task 18.3) catches it and shows the
 * generic, deliberately-unexplained "Something went wrong" fallback (api
 * §0.5: this errorCode is "alerted, not user-facing copy").
 */
export class FatalApiError extends Error {
  readonly errorCode: string;

  constructor(errorCode: string) {
    super('A server error occurred');
    this.name = 'FatalApiError';
    this.errorCode = errorCode;
  }
}

// api §3/§4.6 — a 403 with either of these error codes reaching the client
// at all means a UI hide-rule failed somewhere upstream (fe §7.2/§4.6 name
// the actual prevention: not rendering the triggering field/nav item for a
// CHILD session in the first place). fe §9.4's own framing: "should never
// happen in steady state" — the generic toast + client-error-monitor log
// below is a bug-signal fallback, not the primary UX for this case.
const CHILD_GUARDRAIL_ERROR_CODES = new Set(['CHILD_CAPABILITY_DENIED', 'CHILD_FIELD_NOT_EDITABLE']);

const CHILD_GUARDRAIL_TOAST_MESSAGE = "This action isn't available on this account.";

/**
 * fe §9.4/Task 18.3 — apiRequest()'s single chokepoint for the two
 * cross-cutting error-code reactions that don't fit the 401 retry/redirect
 * branch above: a fatal `TENANT_SCOPE_VIOLATION` (throws, see
 * `FatalApiError`) and a child-guardrail 403 reaching the client anyway
 * (toast + log, never a throw — callers like `AccountProfileForm`/
 * `ProfileEditForm` already branch on `!res.ok` themselves, so this must
 * not consume the response body in a way a real browser `Response` can't
 * recover from). `res.clone()` when available (every real `fetch` Response)
 * keeps the original body stream intact for the caller; test doubles that
 * omit `clone()` fall back to reading `res` directly, safe there because
 * those mocks' `json()` is a plain re-invokable function, not a
 * single-read stream.
 */
async function handleCrossCuttingErrorCodes(res: Response, path: string): Promise<void> {
  if (res.status !== 403 && res.status !== 500) {
    return;
  }

  const source = typeof res.clone === 'function' ? res.clone() : res;
  const body = await parseApiErrorBody(source);
  if (!body) {
    return;
  }

  if (res.status === 500 && body.errorCode === 'TENANT_SCOPE_VIOLATION') {
    throw new FatalApiError(body.errorCode);
  }

  if (res.status === 403 && CHILD_GUARDRAIL_ERROR_CODES.has(body.errorCode)) {
    toast.error(CHILD_GUARDRAIL_TOAST_MESSAGE);
    logClientError('child-capability-denied-reached-client', { path, errorCode: body.errorCode });
  }
}

interface ApiRequestOptions extends Omit<RequestInit, 'headers'> {
  headers?: Record<string, string>;
  /** Internal — set by apiRequest itself when retrying after a refresh. Never pass this at a call site. */
  _isRetry?: boolean;
}

function readCsrfCookie(): string | null {
  if (typeof document === 'undefined') {
    return null;
  }
  const match = document.cookie.match(new RegExp(`(?:^|; )${CSRF_COOKIE}=([^;]*)`));
  return match ? decodeURIComponent(match[1] ?? '') : null;
}

/**
 * fe §6.2 — narrow helper for the two calls that need X-CSRF-Token per the
 * double-submit design (arch §6.4): refreshSession() and logout(). Kept
 * separate from apiRequest's generic header set deliberately: attaching this
 * header to routes that don't check it is harmless, but attaching it
 * *inconsistently* would itself be a signal something's wrong, so it stays
 * scoped to the two routes that actually require it.
 */
function csrfHeaders(): Record<string, string> {
  const csrf = readCsrfCookie();
  return csrf ? { 'X-CSRF-Token': csrf } : {};
}

function redirectToLogin(): void {
  if (typeof window !== 'undefined') {
    window.location.href = '/login';
  }
}

/**
 * POST /auth/refresh — cookie-only, no body (fe §6.1/§6.2). Populates
 * useAuthStore on success and returns whether the refresh succeeded.
 *
 * Impersonation sessions short-circuit to `false` without ever hitting the
 * network: an impersonation access token has no refresh token behind it to
 * rotate (architecture §10, ADR-03 — "no refresh token issued" for an
 * impersonation session), so attempting `/auth/refresh` here would be a
 * doomed round trip, not a real recovery path. The actual exit sequence
 * (discard token, best-effort POST /impersonation/end, refresh the
 * untouched admin cookie) belongs to ImpersonationBanner (Task 16.1) — this
 * function only needs to know not to pretend a refresh is possible.
 */
export async function refreshSession(): Promise<boolean> {
  if (useAuthStore.getState().isImpersonating) {
    return false;
  }

  const res = await fetch(`${API_BASE_URL}/auth/refresh`, {
    method: 'POST',
    credentials: 'include',
    headers: { ...csrfHeaders() },
  });

  if (!res.ok) {
    return false;
  }

  const session = (await res.json()) as AuthSessionResponseDto;
  useAuthStore.getState().setSession({
    accessToken: session.accessToken,
    user: session.user,
    expiresAt: Date.now() + session.expiresIn * 1000,
  });
  return true;
}

/** POST /auth/logout — needs X-CSRF-Token (arch §6.4), same as refreshSession. */
export async function logout(everywhere = false): Promise<void> {
  const { accessToken } = useAuthStore.getState();
  await fetch(`${API_BASE_URL}/auth/logout${everywhere ? '?everywhere=true' : ''}`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      ...(accessToken && { Authorization: `Bearer ${accessToken}` }),
      ...csrfHeaders(),
    },
  });
  useAuthStore.getState().clear();
}

/**
 * fe §4.1 (Task 11.1+) — a sibling to apiRequest() for the handful of
 * endpoints where a 401 does NOT mean "this session's access token
 * expired": POST /auth/login's own invalid-credentials/ACCOUNT_INACTIVE 401
 * (there is no session yet to refresh) and POST /auth/change-password's
 * wrong-currentPassword 401 (the session is perfectly valid — the *password*
 * was wrong). Routing either through apiRequest() would trigger its
 * refresh-then-redirect-to-/login flow on a normal, expected business
 * response, which is exactly the bug this avoids. Same header-attachment
 * behavior as apiRequest() (Authorization when a token is in memory,
 * `credentials: 'include'` for cookies) — just without the 401 special
 * case. Same reasoning as refreshSession()/logout() above already being
 * hand-rolled fetches instead of going through apiRequest().
 */
export async function publicApiRequest(path: string, options: ApiRequestOptions = {}): Promise<Response> {
  const { accessToken } = useAuthStore.getState();
  const { headers: callerHeaders, ...rest } = options;

  const headers: Record<string, string> = {
    ...(accessToken && { Authorization: `Bearer ${accessToken}` }),
    ...callerHeaders,
  };

  return fetch(`${API_BASE_URL}${path}`, { ...rest, headers, credentials: 'include' });
}

/**
 * fe §6.2 — the single fetch wrapper every API call in the app goes
 * through. `Authorization` and `X-Trainer-Context` are attached
 * automatically from the Zustand stores — no call site threads either
 * header through manually, which is what keeps api-spec §0.3's per-endpoint
 * Required/N-A header bucketing from becoming 45 places a developer could
 * forget it.
 *
 * On a 401: one silent-refresh retry, then a hard failure (session cleared,
 * redirected to /login, SessionExpiredError thrown) — never a second retry,
 * and never a retry at all for an impersonation-token 401 (refreshSession
 * itself short-circuits that case).
 */
export async function apiRequest(path: string, options: ApiRequestOptions = {}): Promise<Response> {
  const { accessToken, isImpersonating } = useAuthStore.getState();
  const { activeTrainerId } = useTrainerContextStore.getState();
  const { _isRetry, headers: callerHeaders, ...rest } = options;

  const headers: Record<string, string> = {
    ...(accessToken && { Authorization: `Bearer ${accessToken}` }),
    ...(activeTrainerId && { 'X-Trainer-Context': activeTrainerId }),
    ...callerHeaders,
  };

  const res = await fetch(`${API_BASE_URL}${path}`, { ...rest, headers, credentials: 'include' });

  if (res.status === 401 && !_isRetry) {
    const refreshed = isImpersonating ? false : await refreshSession();
    if (refreshed) {
      return apiRequest(path, { ...options, _isRetry: true });
    }
    useAuthStore.getState().clear();
    redirectToLogin();
    throw new SessionExpiredError();
  }

  await handleCrossCuttingErrorCodes(res, path);

  return res;
}
