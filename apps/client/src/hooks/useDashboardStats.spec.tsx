import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

import { useAuthStore } from '../stores/useAuthStore';
import type { UserSummaryDto } from '../types/auth';

import { useDashboardStats } from './useDashboardStats';

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
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
}

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe('useDashboardStats', () => {
  beforeEach(() => {
    useAuthStore.getState().clear();
    useAuthStore.getState().setSession({ csrfToken: 'test-csrf-token', accessToken: 'token-abc', user: testUser, expiresAt: Date.now() + 60_000 });
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('fetches GET /dashboard/stats and returns the metrics', async () => {
    const body = { role: 'TRAINER', generatedAt: '2026-10-04T00:00:00.000Z', metrics: [{ key: 'connected_players', label: 'Connected players', value: 4 }] };
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(200, body));

    const { result } = renderHook(() => useDashboardStats(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.metrics[0]).toMatchObject({ key: 'connected_players', value: 4 });
    const [path] = (global.fetch as jest.Mock).mock.calls[0];
    expect(path).toContain('/dashboard/stats');
  });

  it('surfaces an error when the request does not resolve ok', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(500));

    const { result } = renderHook(() => useDashboardStats(), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
