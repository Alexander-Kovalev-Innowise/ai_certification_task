import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';

import { useAuthStore } from '../../src/stores/useAuthStore';
import type { UserSummaryDto } from '../../src/types/auth';

import DashboardPage from './page';

const replaceMock = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock }),
}));

function userWithRole(role: UserSummaryDto['role']): UserSummaryDto {
  return {
    id: 'user-1',
    email: 'user@example.com',
    role,
    accountType: 'ADULT',
    firstName: 'Alex',
    lastName: 'B',
    mustChangePassword: false,
  };
}

function mockResponse(status: number, body: unknown = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

function renderDashboard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <DashboardPage />
    </QueryClientProvider>,
  );
}

// specs/frontend-design-spec.md §3 (2026-09-24 note) — the unified
// `/dashboard` route's role-dispatch behavior. This is the seam Phase 11
// exists to fix: one physical route, one component tree, branching on the
// `GET /me/bootstrap` response's `role` field rather than four colliding
// route-grouped pages.
describe('DashboardPage (fe §3, unified /dashboard route)', () => {
  beforeEach(() => {
    useAuthStore.getState().clear();
    replaceMock.mockClear();
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('redirects to /login and renders nothing when there is no session', () => {
    renderDashboard();

    expect(replaceMock).toHaveBeenCalledWith('/login');
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
  });

  it.each([
    ['SUPER_ADMIN', /super admin dashboard/i],
    ['TRAINER', /trainer dashboard/i],
    ['COACH', /coach dashboard/i],
  ] as const)('renders the %s shell for a %s session', async (role, expectedCopy) => {
    const user = userWithRole(role);
    useAuthStore.getState().setSession({ accessToken: 't', user, expiresAt: Date.now() + 60_000 });
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(200, { role, user }));

    renderDashboard();

    await waitFor(() => expect(screen.getByText(expectedCopy)).toBeInTheDocument());
    expect(screen.getByRole('heading', { name: /welcome, alex/i })).toBeInTheDocument();
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it('renders the player/parent shell for a PLAYER_PARENT session', async () => {
    const user = userWithRole('PLAYER_PARENT');
    useAuthStore.getState().setSession({ accessToken: 't', user, expiresAt: Date.now() + 60_000 });
    (global.fetch as jest.Mock).mockResolvedValueOnce(
      mockResponse(200, { role: 'PLAYER_PARENT', accountType: 'ADULT', user, contexts: [], activeContext: null }),
    );

    renderDashboard();

    await waitFor(() => expect(screen.getByText(/dashboard — content coming/i)).toBeInTheDocument());
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it('shows an error state when the bootstrap request fails', async () => {
    const user = userWithRole('TRAINER');
    useAuthStore.getState().setSession({ accessToken: 't', user, expiresAt: Date.now() + 60_000 });
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(500));

    renderDashboard();

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
  });
});
