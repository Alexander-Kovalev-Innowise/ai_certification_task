import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';

import { useAuthStore } from '../../stores/useAuthStore';
import type { UserSummaryDto } from '../../types/auth';
import type { DashboardStatsResponse } from '../../types/dashboard';

// Shared by the dashboard shell specs: seeds an auth session (apiRequest needs
// one), mocks `fetch` for GET /dashboard/stats and renders under a fresh,
// non-retrying QueryClient.
export function mockStatsResponse(status: number, body: unknown = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

export function seedSession(user: UserSummaryDto): void {
  useAuthStore.getState().clear();
  useAuthStore.getState().setSession({ csrfToken: 'test-csrf-token', accessToken: 'token-abc', user, expiresAt: Date.now() + 60_000 });
}

export function mockStats(stats: DashboardStatsResponse | { status: number }): jest.Mock {
  const fetchMock = jest.fn();
  if ('metrics' in stats) {
    fetchMock.mockResolvedValue(mockStatsResponse(200, stats));
  } else {
    fetchMock.mockResolvedValue(mockStatsResponse(stats.status));
  }
  global.fetch = fetchMock;
  return fetchMock;
}

export function renderWithQuery(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}
