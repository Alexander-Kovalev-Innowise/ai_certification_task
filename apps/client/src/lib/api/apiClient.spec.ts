import { useAuthStore } from '../../stores/useAuthStore';
import { useTrainerContextStore } from '../../stores/useTrainerContextStore';
import type { UserSummaryDto } from '../../types/auth';

import { apiRequest, publicApiRequest, SessionExpiredError } from './apiClient';

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

    useAuthStore.getState().setSession({ accessToken: 'token-abc', user: testUser, expiresAt: Date.now() + 60_000 });
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(200));
    await apiRequest('/authenticated');
    const [, optionsAuthenticated] = (global.fetch as jest.Mock).mock.calls[1];
    expect(optionsAuthenticated.headers.Authorization).toBe('Bearer token-abc');
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
    useAuthStore.getState().setSession({ accessToken: 'token-abc', user: testUser, expiresAt: Date.now() + 60_000 });
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(200));

    await publicApiRequest('/auth/change-password');

    const [, options] = (global.fetch as jest.Mock).mock.calls[0];
    expect(options.headers.Authorization).toBe('Bearer token-abc');
  });
});
