import { render, screen } from '@testing-library/react';

import type { UserSummaryDto } from '../../types/auth';
import type { MeBootstrapResponse } from '../../types/bootstrap';

import { PlayerDashboardShell } from './PlayerDashboardShell';

function bootstrap(overrides: Partial<MeBootstrapResponse> = {}): MeBootstrapResponse {
  const user: UserSummaryDto = {
    id: 'parent-user-1',
    email: 'priya@example.com',
    role: 'PLAYER_PARENT',
    accountType: 'ADULT',
    firstName: 'Priya',
    lastName: 'Parent',
    mustChangePassword: false,
  };
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

// fe §4.6 — PlayerDashboardShell: adult shape shows pendingApprovalsCount
// tile linking to /approvals; child shape has no such tile (deny-listed
// field, §9.4). Task 14.2.
describe('PlayerDashboardShell', () => {
  it('greets the user by first name', () => {
    render(<PlayerDashboardShell ctx={bootstrap()} />);

    expect(screen.getByRole('heading', { name: /welcome, priya/i })).toBeInTheDocument();
  });

  it('shows a pendingApprovalsCount tile linking to /approvals for an ADULT account', () => {
    render(<PlayerDashboardShell ctx={bootstrap({ accountType: 'ADULT', pendingApprovalsCount: 3 })} />);

    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText(/pending approvals/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /pending approvals/i })).toHaveAttribute('href', '/approvals');
  });

  it('does not show the approvals tile for a CHILD account (deny-listed field)', () => {
    render(
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

  it('renders a quick link to /profiles for both account types', () => {
    render(<PlayerDashboardShell ctx={bootstrap()} />);

    expect(screen.getByRole('link', { name: /manage profiles/i })).toHaveAttribute('href', '/profiles');
  });
});
