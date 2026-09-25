import { useAuthStore } from '../../stores/useAuthStore';
import { useTrainerContextStore } from '../../stores/useTrainerContextStore';
import type { UserSummaryDto } from '../../types/auth';

import { apiRequest, SessionExpiredError } from './apiClient';

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

// fe §10/Task 18.6 — `apiRequest`'s single-retry-then-hard-fail behavior is
// named alongside `ShareLinkDispatcher`'s branch matrix, `useAuthStore`'s
// boot sequence, and `ImpersonationBanner`'s countdown as this app's four
// highest-value frontend test targets. Extends Task 10.4's original basic
// coverage (still in `apiClient.spec.ts` alongside header-attachment and the
// Task 18.3 cross-cutting error-code tests) with a dedicated file, plus one
// genuinely new case: confirming the retry path is conditioned on a real
// 401, not fired for every response.
describe('apiRequest retry behavior (single-retry-then-hard-fail)', () => {
  beforeEach(() => {
    useAuthStore.getState().clear();
    useTrainerContextStore.getState().setActiveTrainerId(null);
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('retries exactly once on a 401, then hard-fails when the refresh itself 401s', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(mockResponse(401)) // original request
      .mockResolvedValueOnce(mockResponse(401)); // POST /auth/refresh fails too

    await expect(apiRequest('/protected')).rejects.toBeInstanceOf(SessionExpiredError);

    expect(global.fetch).toHaveBeenCalledTimes(2);
    const refreshCallUrl = (global.fetch as jest.Mock).mock.calls[1][0] as string;
    expect(refreshCallUrl).toEqual(expect.stringContaining('/auth/refresh'));
    // Hard failure clears the session (the redirect-to-/login side effect
    // itself isn't observable through jsdom's real `window.location`, which
    // refuses to navigate in tests — covered instead by reading
    // apiClient.ts's redirectToLogin implementation directly in review).
    expect(useAuthStore.getState().accessToken).toBeNull();
  });

  it('retries once after a successful refresh, and does not attempt a second refresh if the retry also 401s', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(mockResponse(401)) // original request
      .mockResolvedValueOnce(mockResponse(200, { accessToken: 'new-token', expiresIn: 900, user: testUser })) // refresh succeeds
      .mockResolvedValueOnce(mockResponse(401)); // retried request still 401s

    const res = await apiRequest('/protected');

    expect(res.status).toBe(401);
    expect(global.fetch).toHaveBeenCalledTimes(3); // original + refresh + one retry, never a second refresh
    expect(useAuthStore.getState().accessToken).toBe('new-token');
  });

  it('resolves normally on a successful retry after refresh', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(mockResponse(401))
      .mockResolvedValueOnce(mockResponse(200, { accessToken: 'new-token', expiresIn: 900, user: testUser }))
      .mockResolvedValueOnce(mockResponse(200, { ok: true }));

    const res = await apiRequest('/protected');

    expect(res.status).toBe(200);
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });

  it('does not call /auth/refresh on a 401 while impersonating — short-circuits straight to a hard failure', async () => {
    useAuthStore.getState().setSession({
      accessToken: 'impersonation-token',
      user: testUser,
      expiresAt: Date.now() + 60_000,
      isImpersonating: true,
    });
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(401));

    await expect(apiRequest('/protected')).rejects.toBeInstanceOf(SessionExpiredError);

    // Only the original request — no /auth/refresh call at all.
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('never calls /auth/refresh for a non-401 response, success or error', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(200));
    await apiRequest('/ok');
    expect(global.fetch).toHaveBeenCalledTimes(1);

    (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(404));
    await apiRequest('/missing');
    expect(global.fetch).toHaveBeenCalledTimes(2); // still just the one call each — no refresh attempt either time

    const calledUrls = (global.fetch as jest.Mock).mock.calls.map(([url]) => url as string);
    expect(calledUrls.some((url) => url.includes('/auth/refresh'))).toBe(false);
  });
});
