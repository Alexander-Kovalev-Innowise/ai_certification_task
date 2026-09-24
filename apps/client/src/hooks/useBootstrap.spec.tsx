import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

import { useAuthStore } from '../stores/useAuthStore';
import type { UserSummaryDto } from '../types/auth';

import { useBootstrap } from './useBootstrap';

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

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe('useBootstrap', () => {
  beforeEach(() => {
    useAuthStore.getState().clear();
    useAuthStore.getState().setSession({ accessToken: 'token-abc', user: testUser, expiresAt: Date.now() + 60_000 });
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('fetches GET /me/bootstrap and returns the role-discriminated response', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(
      mockResponse(200, { role: 'TRAINER', user: testUser, coachCount: 2, activePlayerCount: 5 }),
    );

    const { result } = renderHook(() => useBootstrap(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.role).toBe('TRAINER');
    const [path] = (global.fetch as jest.Mock).mock.calls[0];
    expect(path).toContain('/me/bootstrap');
  });

  it('surfaces an error when the request does not resolve ok', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(500));

    const { result } = renderHook(() => useBootstrap(), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
