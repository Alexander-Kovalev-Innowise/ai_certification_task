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

  it.each([['SUPER_ADMIN', /super admin dashboard/i]] as const)('renders the %s shell for a %s session', async (role, expectedCopy) => {
    const user = userWithRole(role);
    useAuthStore.getState().setSession({ accessToken: 't', user, expiresAt: Date.now() + 60_000 });
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(200, { role, user }));

    renderDashboard();

    await waitFor(() => expect(screen.getByText(expectedCopy)).toBeInTheDocument());
    expect(screen.getByRole('heading', { name: /welcome, alex/i })).toBeInTheDocument();
    expect(replaceMock).not.toHaveBeenCalled();
  });

  // Task 15.2 — CoachDashboardShell now has real content (employing-trainer
  // card, availabilitySet prompt), so it needs the full `CoachBootstrapDto`
  // shape rather than the placeholder `{ role, user }` body (same reasoning
  // as the TRAINER/PLAYER_PARENT shells above, Tasks 13.4/14.2).
  it('renders the COACH shell with an employing-trainer card and availabilitySet prompt for a COACH session', async () => {
    const user = userWithRole('COACH');
    useAuthStore.getState().setSession({ accessToken: 't', user, expiresAt: Date.now() + 60_000 });
    (global.fetch as jest.Mock).mockResolvedValueOnce(
      mockResponse(200, {
        role: 'COACH',
        user,
        coachProfile: { id: 'coach-1', userId: user.id, trainerId: 'trainer-1', status: 'ACTIVE', bio: null, credentials: null, certifications: null, publicProfile: false },
        employingTrainer: { id: 'trainer-1', businessName: 'Ace Tennis Academy', logoUrl: null, primaryColorHex: null },
        availabilitySet: false,
      }),
    );

    renderDashboard();

    await waitFor(() => expect(screen.getByText('Ace Tennis Academy')).toBeInTheDocument());
    expect(screen.getByRole('heading', { name: /welcome, alex/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /set.*availability/i })).toHaveAttribute('href', '/my-times');
    expect(replaceMock).not.toHaveBeenCalled();
  });

  // Task 13.4 — TrainerDashboardShell now has real content (branding
  // preview, coachCount/activePlayerCount stat tiles, quick links), so it
  // needs the full `TrainerBootstrapDto` shape rather than the other two
  // shells' still-placeholder `{ role, user }` body.
  it('renders the TRAINER shell with branding preview, stat tiles and quick links for a TRAINER session', async () => {
    const user = userWithRole('TRAINER');
    useAuthStore.getState().setSession({ accessToken: 't', user, expiresAt: Date.now() + 60_000 });
    (global.fetch as jest.Mock).mockResolvedValueOnce(
      mockResponse(200, {
        role: 'TRAINER',
        user,
        trainerProfile: { id: 'trainer-1', businessName: 'Ace Tennis Academy' },
        branding: { logoUrl: null, primaryColorHex: null },
        coachCount: 3,
        activePlayerCount: 27,
      }),
    );

    renderDashboard();

    await waitFor(() => expect(screen.getByText('Ace Tennis Academy')).toBeInTheDocument());
    expect(screen.getByRole('heading', { name: /welcome, alex/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /manage coaches/i })).toHaveAttribute('href', '/coaches');
    expect(screen.getByRole('link', { name: /manage share links/i })).toHaveAttribute('href', '/share-links');
    expect(replaceMock).not.toHaveBeenCalled();
  });

  // Task 14.2 — PlayerDashboardShell now has real content (pendingApprovalsCount
  // tile for adult accounts, quick link to /profiles), so it needs the full
  // `PlayerParentBootstrapDto` shape rather than the placeholder `{ role, user }` body.
  it('renders the player/parent shell with a pendingApprovalsCount tile for an ADULT PLAYER_PARENT session', async () => {
    const user = userWithRole('PLAYER_PARENT');
    useAuthStore.getState().setSession({ accessToken: 't', user, expiresAt: Date.now() + 60_000 });
    (global.fetch as jest.Mock).mockResolvedValueOnce(
      mockResponse(200, {
        role: 'PLAYER_PARENT',
        accountType: 'ADULT',
        user,
        playerProfiles: [],
        contexts: [],
        activeContext: null,
        pendingApprovalsCount: 2,
      }),
    );

    renderDashboard();

    await waitFor(() => expect(screen.getByText(/pending approvals/i)).toBeInTheDocument());
    expect(screen.getByRole('heading', { name: /welcome, alex/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /manage profiles/i })).toHaveAttribute('href', '/profiles');
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
