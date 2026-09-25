import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import ImpersonationHistoryPage from './page';

function mockResponse(status: number, body: unknown = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    headers: new Headers(),
  } as unknown as Response;
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ImpersonationHistoryPage />
    </QueryClientProvider>,
  );
}

const ADMIN = { id: 'admin-42', email: 'ada@example.com', role: 'SUPER_ADMIN', accountType: 'ADULT', firstName: 'Ada', lastName: 'Admin', mustChangePassword: false };
const TARGET = { id: 'trainer-7', email: 'tom@example.com', role: 'TRAINER', accountType: 'ADULT', firstName: 'Tom', lastName: 'Trainer', mustChangePassword: false };

// fe §5.1/api §2 — `/impersonation-history`: GET /impersonation/history via
// useInfiniteQuery, getNextPageParam reading nextCursor/hasMore directly
// (api §0.9's keyset pagination), same shape as `/users` (Task 12.3). Task
// 16.2. Wrapped by `(super-admin)/layout.tsx`'s RoleGuard(SUPER_ADMIN), so
// this leaf doesn't re-guard.
describe('ImpersonationHistoryPage', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('fetches GET /impersonation/history with the default limit and renders the returned rows', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(
      mockResponse(200, {
        items: [{ id: 'implog-1', admin: ADMIN, target: TARGET, startedAt: '2026-01-05T12:00:00.000Z', endedAt: '2026-01-05T12:20:00.000Z', durationSeconds: 1200 }],
        nextCursor: null,
        hasMore: false,
      }),
    );

    renderPage();

    await waitFor(() => expect(screen.getByRole('row', { name: /ada admin/i })).toBeInTheDocument());

    const [url] = (global.fetch as jest.Mock).mock.calls[0] as [string];
    expect(url).toContain('/impersonation/history?');
    expect(url).toContain('limit=50');
  });

  it('re-fetches with adminUserId/targetUserId/date query params when filters change', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(mockResponse(200, { items: [], nextCursor: null, hasMore: false }));

    renderPage();
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByLabelText(/admin user id/i), { target: { value: 'admin-42' } });

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));
    const [url] = (global.fetch as jest.Mock).mock.calls[1] as [string];
    expect(url).toContain('adminUserId=admin-42');
  });

  it('shows an error state when the request fails', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(500));

    renderPage();

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
  });
});
