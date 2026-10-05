import { useAuthStore } from '../../stores/useAuthStore';
import { useToastStore } from '../../stores/useToastStore';
import { useTrainerContextStore } from '../../stores/useTrainerContextStore';
import type { UserSummaryDto } from '../../types/auth';

import { apiRequest, FatalApiError, logout, publicApiRequest, refreshSession, restoreAdminSession } from './apiClient';

const testUser: UserSummaryDto = {
  id: 'user-1',
  email: 'trainer@example.com',
  role: 'TRAINER',
  accountType: 'ADULT',
  firstName: 'Test',
  lastName: 'Trainer',
  mustChangePassword: false,
};

function mockResponse(status: number, body: unknown = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

// Task 18.6 — the 401-retry-specific behavior this describe block used to
// hold entirely (Task 10.4's original coverage) now lives in its own file,
// `apiClient.retry.spec.ts`, extended there with one new case (a non-401
// response never triggers a refresh attempt). This block keeps the
// header-attachment coverage, which isn't retry-specific.
describe('apiRequest', () => {
  beforeEach(() => {
    useAuthStore.getState().clear();
    useTrainerContextStore.getState().setActiveTrainerId(null);
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('attaches X-Trainer-Context only when a trainer context is active', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(200));
    await apiRequest('/no-context');
    const [, optionsWithoutContext] = (global.fetch as jest.Mock).mock.calls[0];
    expect(optionsWithoutContext.headers['X-Trainer-Context']).toBeUndefined();

    useTrainerContextStore.getState().setActiveTrainerId('trainer-1');
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(200));
    await apiRequest('/with-context');
    const [, optionsWithContext] = (global.fetch as jest.Mock).mock.calls[1];
    expect(optionsWithContext.headers['X-Trainer-Context']).toBe('trainer-1');
  });

  it('attaches Authorization only when an access token is present', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(200));
    await apiRequest('/anonymous');
    const [, optionsAnonymous] = (global.fetch as jest.Mock).mock.calls[0];
    expect(optionsAnonymous.headers.Authorization).toBeUndefined();

    useAuthStore.getState().setSession({ csrfToken: 'test-csrf-token', accessToken: 'token-abc', user: testUser, expiresAt: Date.now() + 60_000 });
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(200));
    await apiRequest('/authenticated');
    const [, optionsAuthenticated] = (global.fetch as jest.Mock).mock.calls[1];
    expect(optionsAuthenticated.headers.Authorization).toBe('Bearer token-abc');
  });

});

// fe §9.4/Task 18.3 — the cross-cutting error-code handling apiRequest
// layers on top of the plain 401-retry logic: `500 TENANT_SCOPE_VIOLATION`
// (architecture §8 Layer 2 — should never reach the client, must degrade
// safely if it does) throws `FatalApiError` so TanStack Query's
// `throwOnError` (QueryProvider.tsx) can hand it to the root `ErrorBoundary`;
// a `403 CHILD_CAPABILITY_DENIED`/`CHILD_FIELD_NOT_EDITABLE` reaching the
// client anyway fires the generic toast + client-error-monitor log fallback
// (should never happen in steady state — a hide-rule bug signal, not a
// normal path) while still returning the response normally, since callers
// like AccountProfileForm/ProfileEditForm already branch on `!res.ok`
// themselves.
describe('apiRequest — cross-cutting error-code handling (fe §9.4)', () => {
  beforeEach(() => {
    useAuthStore.getState().clear();
    useTrainerContextStore.getState().setActiveTrainerId(null);
    useToastStore.setState({ toasts: [] });
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('throws FatalApiError on a 500 TENANT_SCOPE_VIOLATION instead of returning the response', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(500, { errorCode: 'TENANT_SCOPE_VIOLATION', message: 'x' }));

    await expect(apiRequest('/roster')).rejects.toBeInstanceOf(FatalApiError);
  });

  it('returns an ordinary 500 normally when it does not carry TENANT_SCOPE_VIOLATION', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(500, { errorCode: 'INTERNAL_ERROR' }));

    const res = await apiRequest('/roster');
    expect(res.status).toBe(500);
  });

  it('fires a generic error toast + client-error-monitor log on 403 CHILD_FIELD_NOT_EDITABLE, but still returns the response', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(403, { errorCode: 'CHILD_FIELD_NOT_EDITABLE', details: [] }));

    const res = await apiRequest('/me', { method: 'PATCH' });

    expect(res.status).toBe(403);
    expect(useToastStore.getState().toasts).toHaveLength(1);
    expect(useToastStore.getState().toasts[0]).toMatchObject({ variant: 'error' });
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('client-error-monitor'), expect.anything());

    errorSpy.mockRestore();
  });

  it('fires the same fallback on 403 CHILD_CAPABILITY_DENIED', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(403, { errorCode: 'CHILD_CAPABILITY_DENIED' }));

    await apiRequest('/approvals');

    expect(useToastStore.getState().toasts).toHaveLength(1);
  });

  it('does not fire a toast for an unrelated 403 errorCode', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(403, { errorCode: 'TENANT_CONTEXT_INVALID' }));

    await apiRequest('/players');

    expect(useToastStore.getState().toasts).toHaveLength(0);
  });
});

describe('publicApiRequest', () => {
  beforeEach(() => {
    useAuthStore.getState().clear();
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('does not retry or clear the session on a 401 — Task 11.1/11.6\'s own business-logic 401s are not "session expired"', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(401, { errorCode: 'ACCOUNT_INACTIVE' }));

    const res = await publicApiRequest('/auth/login');

    expect(res.status).toBe(401);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('attaches Authorization when an access token is present, but never X-Trainer-Context', async () => {
    useAuthStore.getState().setSession({ csrfToken: 'test-csrf-token', accessToken: 'token-abc', user: testUser, expiresAt: Date.now() + 60_000 });
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(200));

    await publicApiRequest('/auth/change-password');

    const [, options] = (global.fetch as jest.Mock).mock.calls[0];
    expect(options.headers.Authorization).toBe('Bearer token-abc');
  });
});

describe('refreshSession — single-flight', () => {
  beforeEach(() => {
    useAuthStore.getState().clear();
    global.fetch = jest.fn();
  });

  it('shares one POST /auth/refresh between concurrent callers (the refresh token rotates, so a second request would be treated as reuse)', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(
      mockResponse(200, { accessToken: 'new-token', expiresIn: 900, csrfToken: 'csrf', user: testUser }),
    );

    const results = await Promise.all([refreshSession(), refreshSession(), refreshSession()]);

    expect(results).toEqual([true, true, true]);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(useAuthStore.getState().accessToken).toBe('new-token');
  });

  it('allows a fresh request once the in-flight one has settled', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(mockResponse(401));

    await refreshSession();
    await refreshSession();

    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
});

// Spec §13 CSRF — what the client must send for the server's Origin check
// (the browser adds `Origin` itself) and the logout double-submit token.
describe('refreshSession / logout — CSRF inputs', () => {
  const session = { accessToken: 'new-token', expiresIn: 900, csrfToken: 'fresh-csrf', user: testUser };

  beforeEach(() => {
    useAuthStore.getState().clear();
    global.fetch = jest.fn();
  });

  it('refresh after a page reload (no in-memory token yet) sends credentials but no X-CSRF-Token, and stores the returned csrfToken', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(200, session));

    await refreshSession();

    const [, init] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
    expect(init.credentials).toBe('include');
    expect(init.headers['X-CSRF-Token']).toBeUndefined();
    expect(useAuthStore.getState().csrfToken).toBe('fresh-csrf');
  });

  it('logout right after that refresh sends the in-memory token as X-CSRF-Token, with the bearer token and credentials', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(200, session)).mockResolvedValueOnce(mockResponse(204));
    await refreshSession();

    await logout();

    const [url, init] = (global.fetch as jest.Mock).mock.calls[1] as [string, RequestInit & { headers: Record<string, string> }];
    expect(url).toContain('/auth/logout');
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('include');
    expect(init.headers['X-CSRF-Token']).toBe('fresh-csrf');
    expect(init.headers.Authorization).toBe('Bearer new-token');
    expect(useAuthStore.getState().accessToken).toBeNull();
  });

  it('logout that gets a 403 (csrf token stale after another tab rotated the session) re-syncs via refresh and retries once', async () => {
    useAuthStore.getState().setSession({ csrfToken: 'stale-csrf', accessToken: 'old-token', user: testUser, expiresAt: Date.now() + 60_000 });
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(mockResponse(403, { errorCode: 'CSRF_MISMATCH' }))
      .mockResolvedValueOnce(mockResponse(200, session))
      .mockResolvedValueOnce(mockResponse(204));

    await logout();

    const calls = (global.fetch as jest.Mock).mock.calls as [string, RequestInit & { headers: Record<string, string> }][];
    expect(calls.map(([url]) => url.replace(/^.*(?=\/auth)/, ''))).toEqual(['/auth/logout', '/auth/refresh', '/auth/logout']);
    expect(calls[2]![1].headers['X-CSRF-Token']).toBe('fresh-csrf');
    expect(useAuthStore.getState().accessToken).toBeNull();
  });

  it('logout while impersonating exits impersonation and refreshes the admin session first, then logs the admin out with the admin csrf token', async () => {
    useAuthStore.getState().setSession({ csrfToken: '', accessToken: 'imp-token', user: testUser, expiresAt: Date.now() + 60_000, isImpersonating: true });
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(mockResponse(204)) // POST /impersonation/end
      .mockResolvedValueOnce(mockResponse(200, session)) // POST /auth/refresh (admin cookie)
      .mockResolvedValueOnce(mockResponse(204)); // POST /auth/logout

    await logout();

    const calls = (global.fetch as jest.Mock).mock.calls as [string, RequestInit & { headers: Record<string, string> }][];
    expect(calls.map(([url]) => url.replace(/^.*(?=\/(auth|impersonation))/, ''))).toEqual([
      '/impersonation/end',
      '/auth/refresh',
      '/auth/logout',
    ]);
    expect(calls[2]![1].headers['X-CSRF-Token']).toBe('fresh-csrf');
    expect(calls[2]![1].headers.Authorization).toBe('Bearer new-token');
    expect(useAuthStore.getState().accessToken).toBeNull();
  });

  it('logout while impersonating, when the admin session cannot be restored, just clears local state without calling /auth/logout', async () => {
    useAuthStore.getState().setSession({ csrfToken: '', accessToken: 'imp-token', user: testUser, expiresAt: Date.now() + 60_000, isImpersonating: true });
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(401)).mockResolvedValueOnce(mockResponse(401));

    await logout();

    const urls = (global.fetch as jest.Mock).mock.calls.map(([url]: [string]) => url);
    expect(urls.some((u) => u.includes('/auth/logout'))).toBe(false);
    expect(useAuthStore.getState().accessToken).toBeNull();
  });

  // Regression: clearing the whole store before the refresh made every RoleGuard see "no user" and
  // router.replace('/login'); on /dashboard nothing navigated back, stranding the signed-in admin on /login.
  it('restoreAdminSession never lets the store go user-less while the admin session is refreshed', async () => {
    useAuthStore.getState().setSession({ csrfToken: '', accessToken: 'imp-token', user: testUser, expiresAt: Date.now() + 60_000, isImpersonating: true });
    const users: Array<string | null> = [];
    const unsubscribe = useAuthStore.subscribe((state) => users.push(state.user?.id ?? null));
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(200, session)); // POST /auth/refresh (admin cookie)

    const restored = await restoreAdminSession();
    unsubscribe();

    expect(restored).toBe(true);
    expect(users).not.toContain(null);
    expect(useAuthStore.getState().isImpersonating).toBe(false);
    expect(useAuthStore.getState().accessToken).toBe('new-token');
  });

  it('restoreAdminSession clears the whole store when the admin session cannot be restored', async () => {
    useAuthStore.getState().setSession({ csrfToken: '', accessToken: 'imp-token', user: testUser, expiresAt: Date.now() + 60_000, isImpersonating: true });
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(401));

    expect(await restoreAdminSession()).toBe(false);
    expect(useAuthStore.getState().user).toBeNull();
    expect(useAuthStore.getState().accessToken).toBeNull();
  });
});
