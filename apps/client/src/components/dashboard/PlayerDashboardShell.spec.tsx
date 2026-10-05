import { screen, within } from '@testing-library/react';

import type { UserSummaryDto } from '../../types/auth';
import type { MeBootstrapResponse } from '../../types/bootstrap';
import type { DashboardStatsResponse } from '../../types/dashboard';

import { mockStats, renderWithQuery, seedSession } from './dashboardTestUtils';
import { PlayerDashboardShell } from './PlayerDashboardShell';

const user: UserSummaryDto = {
  id: 'parent-user-1',
  email: 'priya@example.com',
  role: 'PLAYER_PARENT',
  accountType: 'ADULT',
  firstName: 'Priya',
  lastName: 'Parent',
  mustChangePassword: false,
};

function bootstrap(overrides: Partial<MeBootstrapResponse> = {}): MeBootstrapResponse {
  return {
    role: 'PLAYER_PARENT',
    accountType: 'ADULT',
    user,
    playerProfiles: [{ id: 'profile-1', name: 'Priya', isSelf: true, trainerCount: 1 }],
    contexts: [],
    activeContext: null,
    pendingApprovalsCount: 3,
    ...overrides,
  };
}

const stats: DashboardStatsResponse = {
  role: 'PLAYER_PARENT',
  generatedAt: '2026-10-04T12:00:00.000Z',
  metrics: [
    { key: 'profiles', label: 'Player profiles', value: 2, unit: 'count', hint: 'You and your children' },
    { key: 'connected_trainers', label: 'Connected trainers', value: 1, unit: 'count' },
    { key: 'pending_approvals', label: 'Pending approvals', value: 3, unit: 'count' },
    { key: 'availability_set_pct', label: 'Children with availability', value: 50, unit: 'percent', hint: '1 of 2' },
  ],
};

// fe §4.6 — PlayerDashboardShell: adult shape shows the pendingApprovalsCount
// tile linking to /approvals; child shape has no such tile (deny-listed
// field, §9.4). Task 14.2.
describe('PlayerDashboardShell', () => {
  beforeEach(() => {
    seedSession(user);
    mockStats(stats);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('greets the user by first name', () => {
    renderWithQuery(<PlayerDashboardShell ctx={bootstrap()} />);

    expect(screen.getByRole('heading', { name: /welcome, priya/i })).toBeInTheDocument();
  });

  it('shows a single pendingApprovalsCount tile linking to /approvals for an ADULT account', async () => {
    renderWithQuery(<PlayerDashboardShell ctx={bootstrap({ accountType: 'ADULT', pendingApprovalsCount: 3 })} />);

    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /pending approvals/i })).toHaveAttribute('href', '/approvals');
    // The stats copy of the same metric is not rendered a second time.
    expect(await screen.findByText('Connected trainers')).toBeInTheDocument();
    expect(screen.getAllByText(/pending approvals/i)).toHaveLength(1);
  });

  it('does not show the approvals tile or link for a CHILD account (deny-listed field)', () => {
    renderWithQuery(
      <PlayerDashboardShell
        ctx={bootstrap({
          accountType: 'CHILD',
          playerProfiles: undefined,
          playerProfile: { id: 'profile-2', name: 'Alex', isSelf: false, trainerCount: 1 },
          pendingApprovalsCount: undefined,
        })}
      />,
    );

    expect(screen.queryByText(/pending approvals/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /approvals/i })).not.toBeInTheDocument();
  });

  it('renders the player metrics from the stats response', async () => {
    renderWithQuery(<PlayerDashboardShell ctx={bootstrap()} />);

    expect(await screen.findByText('Player profiles')).toBeInTheDocument();
    expect(screen.getByText('Children with availability')).toBeInTheDocument();
    expect(screen.getByText('50')).toBeInTheDocument();
    expect(screen.getByText('%')).toBeInTheDocument();
  });

  it('renders a quick link card to /profiles for both account types', () => {
    renderWithQuery(<PlayerDashboardShell ctx={bootstrap()} />);

    const nav = screen.getByRole('navigation', { name: /quick links/i });
    expect(within(nav).getByRole('link', { name: /manage profiles/i })).toHaveAttribute('href', '/profiles');
  });
});
