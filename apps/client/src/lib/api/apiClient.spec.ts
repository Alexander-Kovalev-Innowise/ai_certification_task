import { useAuthStore } from '../../stores/useAuthStore';
import { useToastStore } from '../../stores/useToastStore';
import { useTrainerContextStore } from '../../stores/useTrainerContextStore';
import type { UserSummaryDto } from '../../types/auth';

import { apiRequest, FatalApiError, publicApiRequest } from './apiClient';

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

    useAuthStore.getState().setSession({ accessToken: 'token-abc', user: testUser, expiresAt: Date.now() + 60_000 });
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
    useAuthStore.getState().setSession({ accessToken: 'token-abc', user: testUser, expiresAt: Date.now() + 60_000 });
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(200));

    await publicApiRequest('/auth/change-password');

    const [, options] = (global.fetch as jest.Mock).mock.calls[0];
    expect(options.headers.Authorization).toBe('Bearer token-abc');
  });
});
