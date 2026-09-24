import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';

import { useAuthStore } from '../../src/stores/useAuthStore';
import type { UserSummaryDto } from '../../src/types/auth';

import PlayerLayout from './layout';

const replaceMock = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock }),
}));

function userWithRole(role: UserSummaryDto['role'], accountType: UserSummaryDto['accountType'] = 'ADULT'): UserSummaryDto {
  return {
    id: 'user-1',
    email: 'parent@example.com',
    role,
    accountType,
    firstName: 'Priya',
    lastName: 'Parent',
    mustChangePassword: false,
  };
}

function mockResponse(status: number, body: unknown = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    headers: new Headers(),
  } as unknown as Response;
}

function renderLayout() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <PlayerLayout>
        <div>page content</div>
      </PlayerLayout>
    </QueryClientProvider>,
  );
}

// fe §3/§4.6 — `(player)/layout.tsx`: RoleGuard(PLAYER_PARENT), mounts
// ContextSwitcher sourced from GET /me/bootstrap's contexts/activeContext.
// Task 14.1.
describe('PlayerLayout', () => {
  beforeEach(() => {
    useAuthStore.getState().clear();
    replaceMock.mockClear();
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('mounts ContextSwitcher from bootstrap and renders children for a PLAYER_PARENT session', async () => {
    useAuthStore.getState().setSession({ accessToken: 't', user: userWithRole('PLAYER_PARENT'), expiresAt: Date.now() + 60_000 });
    (global.fetch as jest.Mock).mockResolvedValueOnce(
      mockResponse(200, {
        role: 'PLAYER_PARENT',
        accountType: 'ADULT',
        user: userWithRole('PLAYER_PARENT'),
        playerProfiles: [],
        contexts: [
          {
            playerProfileId: 'profile-1',
            playerProfileName: 'Priya',
            isSelf: true,
            trainerId: 'trainer-1',
            trainerDisplayName: 'Coach Lisa',
            logoUrl: null,
            primaryColorHex: '#112233',
            connectedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
        activeContext: {
          playerProfileId: 'profile-1',
          playerProfileName: 'Priya',
          isSelf: true,
          trainerId: 'trainer-1',
          trainerDisplayName: 'Coach Lisa',
          logoUrl: null,
          primaryColorHex: '#112233',
          connectedAt: '2026-01-01T00:00:00.000Z',
        },
        pendingApprovalsCount: 0,
      }),
    );

    const { container } = renderLayout();

    await waitFor(() => expect(screen.getByText('page content')).toBeInTheDocument());
    expect(replaceMock).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/active trainer context/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /approvals/i })).toHaveAttribute('href', '/approvals');

    const brandingEl = container.querySelector('[data-branding]');
    expect(brandingEl).toHaveStyle({ '--brand-primary': '#112233' });
  });

  // fe §4.6/§9.4 — Approvals is adult-parent-only (APPROVE_CHILD_PURCHASE is
  // CHILD-denied, api §4.6); the nav item is hidden entirely for a CHILD
  // session, not just disabled. Task 14.8.
  it('hides the Approvals nav item for a CHILD session', async () => {
    useAuthStore.getState().setSession({ accessToken: 't', user: userWithRole('PLAYER_PARENT', 'CHILD'), expiresAt: Date.now() + 60_000 });
    (global.fetch as jest.Mock).mockResolvedValueOnce(
      mockResponse(200, {
        role: 'PLAYER_PARENT',
        accountType: 'CHILD',
        user: userWithRole('PLAYER_PARENT', 'CHILD'),
        playerProfile: { id: 'profile-2', name: 'Alex', isSelf: false, trainerCount: 1 },
        contexts: [],
        activeContext: null,
      }),
    );

    renderLayout();

    await waitFor(() => expect(screen.getByText('page content')).toBeInTheDocument());
    expect(screen.queryByRole('link', { name: /approvals/i })).not.toBeInTheDocument();
  });

  it('redirects to /login and renders nothing when there is no session', () => {
    renderLayout();

    expect(screen.queryByText('page content')).not.toBeInTheDocument();
    expect(replaceMock).toHaveBeenCalledWith('/login');
  });

  it('redirects to /dashboard and renders nothing for a non-PLAYER_PARENT session', () => {
    useAuthStore.getState().setSession({ accessToken: 't', user: userWithRole('COACH'), expiresAt: Date.now() + 60_000 });

    renderLayout();

    expect(screen.queryByText('page content')).not.toBeInTheDocument();
    expect(replaceMock).toHaveBeenCalledWith('/dashboard');
  });
});
