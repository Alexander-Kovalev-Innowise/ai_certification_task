import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

import { useAuthStore } from '../stores/useAuthStore';
import type { UserSummaryDto } from '../types/auth';

import { useMe } from './useMe';

const testUser: UserSummaryDto = {
  id: 'user-1',
  email: 'coach@example.com',
  role: 'COACH',
  accountType: 'ADULT',
  firstName: 'Test',
  lastName: 'Coach',
  mustChangePassword: false,
};

function mockResponse(status: number, body: unknown = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

// Task 18.1 — `useMe`: `GET /me` (api §3/Task 2.22's `MeResponseDto`),
// shared by `/account/profile` (AccountProfileForm) and `EmailVerifiedBanner`
// (Task 18.2) so both read the same `['me']` cache entry rather than each
// firing its own request.
describe('useMe', () => {
  beforeEach(() => {
    useAuthStore.getState().clear();
    useAuthStore.getState().setSession({ accessToken: 'token-abc', user: testUser, expiresAt: Date.now() + 60_000 });
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('fetches GET /me and returns the parsed body', async () => {
    const body = {
      id: 'user-1',
      email: 'coach@example.com',
      role: 'COACH',
      accountType: 'ADULT',
      firstName: 'Test',
      lastName: 'Coach',
      phone: null,
      photoUrl: null,
      emailVerified: false,
      mustChangePassword: false,
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(200, body));

    const { result } = renderHook(() => useMe(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual(body);
    const [url] = (global.fetch as jest.Mock).mock.calls[0] as [string];
    expect(url).toContain('/me');
    expect(url).not.toContain('/me/bootstrap');
  });

  it('surfaces a non-ok response as a query error', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(500));

    const { result } = renderHook(() => useMe(), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
