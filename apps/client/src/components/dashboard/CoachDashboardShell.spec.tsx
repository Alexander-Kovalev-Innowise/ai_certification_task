import { screen, within } from '@testing-library/react';

import type { UserSummaryDto } from '../../types/auth';
import type { MeBootstrapResponse } from '../../types/bootstrap';
import type { DashboardStatsResponse } from '../../types/dashboard';

import { CoachDashboardShell } from './CoachDashboardShell';
import { mockStats, renderWithQuery, seedSession } from './dashboardTestUtils';

const user: UserSummaryDto = {
  id: 'coach-user-1',
  email: 'cory@example.com',
  role: 'COACH',
  accountType: 'ADULT',
  firstName: 'Cory',
  lastName: 'Coach',
  mustChangePassword: false,
};

function bootstrap(overrides: Partial<MeBootstrapResponse> = {}): MeBootstrapResponse {
  return {
    role: 'COACH',
    user,
    coachProfile: {
      id: 'coach-1',
      userId: 'coach-user-1',
      trainerId: 'trainer-1',
      status: 'ACTIVE',
      bio: null,
      credentials: null,
      certifications: null,
      publicProfile: false,
    },
    employingTrainer: { id: 'trainer-1', businessName: 'Ace Tennis Academy', logoUrl: null, primaryColorHex: null },
    availabilitySet: true,
    ...overrides,
  };
}

const stats: DashboardStatsResponse = {
  role: 'COACH',
  generatedAt: '2026-10-04T12:00:00.000Z',
  metrics: [
    { key: 'weekly_slots', label: 'Weekly availability slots', value: 6, unit: 'count' },
    { key: 'weekly_hours', label: 'Available hours per week', value: 12.5, unit: 'hours' },
    { key: 'availability_overrides_30d', label: 'Schedule overrides', value: 2, unit: 'count', delta: { value: 0, period: 'month', direction: 'flat' } },
    { key: 'team_coaches', label: 'Coaches on the team', value: 4, unit: 'count', hint: 'At Ace Tennis Academy' },
  ],
};

// fe §4.5 — CoachDashboardShell: employing-trainer card, availabilitySet
// prompt, own metrics, quick-link cards. Task 15.2.
describe('CoachDashboardShell', () => {
  beforeEach(() => {
    seedSession(user);
    mockStats(stats);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('greets the coach by first name', () => {
    renderWithQuery(<CoachDashboardShell ctx={bootstrap()} />);

    expect(screen.getByRole('heading', { name: /welcome, cory/i })).toBeInTheDocument();
  });

  it('shows the employing trainer card with business name and logo', () => {
    renderWithQuery(
      <CoachDashboardShell
        ctx={bootstrap({ employingTrainer: { id: 'trainer-1', businessName: 'Ace Tennis Academy', logoUrl: 'https://cdn.example.com/logo.png', primaryColorHex: '#112233' } })}
      />,
    );

    expect(screen.getByText('Ace Tennis Academy')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /ace tennis academy logo/i })).toHaveAttribute('src', 'https://cdn.example.com/logo.png');
  });

  it('falls back to the platform default logo when the employing trainer has no logoUrl', () => {
    renderWithQuery(<CoachDashboardShell ctx={bootstrap()} />);

    expect(screen.getByRole('img', { name: /ace tennis academy logo/i })).toHaveAttribute('src', '/default_logo.svg');
  });

  it('shows an availabilitySet prompt linking to /my-times when availabilitySet is false', () => {
    renderWithQuery(<CoachDashboardShell ctx={bootstrap({ availabilitySet: false })} />);

    expect(screen.getByRole('status')).toHaveTextContent(/set your availability/i);
    expect(screen.getByRole('link', { name: /set.*availability/i })).toHaveAttribute('href', '/my-times');
  });

  it('does not show the availabilitySet prompt when availabilitySet is true', () => {
    renderWithQuery(<CoachDashboardShell ctx={bootstrap({ availabilitySet: true })} />);

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('renders the coach metrics with units, flat delta and hint', async () => {
    renderWithQuery(<CoachDashboardShell ctx={bootstrap()} />);

    expect(await screen.findByText('Weekly availability slots')).toBeInTheDocument();
    expect(screen.getByText('12.5')).toBeInTheDocument();
    expect(screen.getByText('h')).toBeInTheDocument();
    expect(screen.getByTestId('stat-delta')).toHaveAttribute('data-direction', 'flat');
    expect(screen.getByText('At Ace Tennis Academy')).toBeInTheDocument();
  });

  it('renders quick link cards into My Times and Profile', () => {
    renderWithQuery(<CoachDashboardShell ctx={bootstrap()} />);

    const nav = screen.getByRole('navigation', { name: /quick links/i });
    expect(within(nav).getByRole('link', { name: /my times/i })).toHaveAttribute('href', '/my-times');
    expect(within(nav).getByRole('link', { name: /profile/i })).toHaveAttribute('href', '/profile');
  });
});
