import { screen, within } from '@testing-library/react';

import type { UserSummaryDto } from '../../types/auth';
import type { MeBootstrapResponse } from '../../types/bootstrap';
import type { DashboardStatsResponse } from '../../types/dashboard';

import { mockStats, renderWithQuery, seedSession } from './dashboardTestUtils';
import { TrainerDashboardShell } from './TrainerDashboardShell';

const user: UserSummaryDto = {
  id: 'trainer-user-1',
  email: 'tia@example.com',
  role: 'TRAINER',
  accountType: 'ADULT',
  firstName: 'Tia',
  lastName: 'Trainer',
  mustChangePassword: false,
};

function bootstrap(overrides: Partial<MeBootstrapResponse> = {}): MeBootstrapResponse {
  return {
    role: 'TRAINER',
    user,
    trainerProfile: { id: 'trainer-1', businessName: 'Ace Tennis Academy' },
    branding: { logoUrl: null, primaryColorHex: null },
    coachCount: 3,
    activePlayerCount: 27,
    ...overrides,
  };
}

const stats: DashboardStatsResponse = {
  role: 'TRAINER',
  generatedAt: '2026-10-04T12:00:00.000Z',
  metrics: [
    { key: 'connected_players', label: 'Connected players', value: 27, unit: 'count' },
    { key: 'active_coaches', label: 'Active coaches', value: 3, unit: 'count' },
    { key: 'pending_coach_invites', label: 'Pending coach invites', value: 2, unit: 'count' },
    { key: 'players_with_availability_pct', label: 'Players with availability', value: 40, unit: 'percent', hint: '11 of 27 players' },
    {
      key: 'share_link_redemptions_30d',
      label: 'Share link sign-ups',
      value: 5,
      unit: 'count',
      delta: { value: 2, period: 'month', direction: 'down' },
    },
  ],
};

// fe §4.4 — TrainerDashboardShell: branding preview, bootstrap-backed
// coach/player tiles, tenant metrics, quick-link cards. Task 13.4.
describe('TrainerDashboardShell', () => {
  beforeEach(() => {
    seedSession(user);
    mockStats(stats);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('greets the trainer by first name', () => {
    renderWithQuery(<TrainerDashboardShell ctx={bootstrap()} />);

    expect(screen.getByRole('heading', { name: /welcome, tia/i })).toBeInTheDocument();
  });

  it('shows a branding preview with the business name and logo', () => {
    renderWithQuery(
      <TrainerDashboardShell ctx={bootstrap({ branding: { logoUrl: 'https://cdn.example.com/logo.png', primaryColorHex: '#112233' } })} />,
    );

    expect(screen.getByText('Ace Tennis Academy')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /ace tennis academy logo/i })).toHaveAttribute('src', 'https://cdn.example.com/logo.png');
  });

  it('falls back to the platform default logo when branding has no logoUrl', () => {
    renderWithQuery(<TrainerDashboardShell ctx={bootstrap({ branding: { logoUrl: null, primaryColorHex: null } })} />);

    expect(screen.getByRole('img', { name: /ace tennis academy logo/i })).toHaveAttribute('src', '/default_logo.svg');
  });

  it('renders coachCount and activePlayerCount tiles immediately from bootstrap', () => {
    renderWithQuery(<TrainerDashboardShell ctx={bootstrap({ coachCount: 3, activePlayerCount: 27 })} />);

    expect(screen.getByText('Coaches')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('Active Players')).toBeInTheDocument();
    expect(screen.getByText('27')).toBeInTheDocument();
  });

  it('renders the stats metrics without duplicating the bootstrap-backed tiles', async () => {
    renderWithQuery(<TrainerDashboardShell ctx={bootstrap()} />);

    expect(await screen.findByText('Pending coach invites')).toBeInTheDocument();
    expect(screen.getByText('Players with availability')).toBeInTheDocument();
    expect(screen.getByText('40')).toBeInTheDocument();
    expect(screen.getByText('11 of 27 players')).toBeInTheDocument();
    expect(screen.getByTestId('stat-delta')).toHaveAttribute('data-direction', 'down');
    expect(screen.queryByText('Connected players')).not.toBeInTheDocument();
    expect(screen.queryByText('Active coaches')).not.toBeInTheDocument();
  });

  it('keeps the bootstrap tiles and shows a retry alert when the stats request fails', async () => {
    mockStats({ status: 500 });
    renderWithQuery(<TrainerDashboardShell ctx={bootstrap()} />);

    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn.t load your metrics/i);
    expect(screen.getByText('Active Players')).toBeInTheDocument();
  });

  it('renders quick link cards into Coaches, Players, Share Links and Branding', () => {
    renderWithQuery(<TrainerDashboardShell ctx={bootstrap()} />);

    const nav = screen.getByRole('navigation', { name: /quick links/i });
    expect(within(nav).getByRole('link', { name: /manage coaches/i })).toHaveAttribute('href', '/coaches');
    expect(within(nav).getByRole('link', { name: /players/i })).toHaveAttribute('href', '/players');
    expect(within(nav).getByRole('link', { name: /manage share links/i })).toHaveAttribute('href', '/share-links');
    expect(within(nav).getByRole('link', { name: /branding/i })).toHaveAttribute('href', '/branding');
  });
});
