import { refreshSession } from '../lib/api/apiClient';
import type { UserSummaryDto } from '../types/auth';

import { useAuthStore } from './useAuthStore';

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

// fe §6.1/§10/Task 18.6 — `useAuthStore`'s boot sequence (refresh success/
// failure paths) is one of the four frontend test targets fe §10 names as
// highest-value. Tested elsewhere only indirectly — `app/layout.spec.tsx`
// exercises it through the FULL `RootLayout`/`BootSequence` tree,
// `apiClient(.retry).spec.ts` exercises it as a side effect of `apiRequest`'s
// 401-retry path — this file isolates `refreshSession()` itself (Task
// 10.4/fe §6.1's `POST /auth/refresh`, cookie-only, no body) and its direct
// effect on `useAuthStore`, without either of those surrounding layers.
describe("useAuthStore's boot sequence (refreshSession)", () => {
  beforeEach(() => {
    useAuthStore.getState().clear();
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('on a 200, populates useAuthStore from the AuthSessionResponseDto and resolves true', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(200, { accessToken: 'fresh-token', expiresIn: 900, user: testUser }));

    const result = await refreshSession();

    expect(result).toBe(true);
    const state = useAuthStore.getState();
    expect(state.accessToken).toBe('fresh-token');
    expect(state.user).toEqual(testUser);
    expect(state.isImpersonating).toBe(false);
    // expiresAt is derived from Date.now() + expiresIn*1000 at call time —
    // assert it lands in the expected ~15-minute window rather than an
    // exact timestamp (lib/api/authSession.ts's own documented Date.now()
    // convention, same reasoning applied to this assertion).
    expect(state.expiresAt).toBeGreaterThan(Date.now() + 800_000);
    expect(state.expiresAt).toBeLessThanOrEqual(Date.now() + 900_000);
  });

  it('on a non-ok response, leaves useAuthStore untouched and resolves false', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(401));

    const result = await refreshSession();

    expect(result).toBe(false);
    expect(useAuthStore.getState().accessToken).toBeNull();
    expect(useAuthStore.getState().user).toBeNull();
  });

  it('short-circuits to false without calling fetch at all when already impersonating', async () => {
    useAuthStore.getState().setSession({ accessToken: 'imp-token', user: testUser, expiresAt: Date.now() + 60_000, isImpersonating: true });

    const result = await refreshSession();

    expect(result).toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
    // The impersonation session itself is left alone — a failed/skipped
    // refresh attempt must not clear an otherwise-valid impersonation token.
    expect(useAuthStore.getState().accessToken).toBe('imp-token');
  });

  it('calls POST /auth/refresh with credentials included and no body', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(200, { accessToken: 'fresh-token', expiresIn: 900, user: testUser }));

    await refreshSession();

    const [url, init] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/auth/refresh');
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('include');
    expect(init.body).toBeUndefined();
  });
});
