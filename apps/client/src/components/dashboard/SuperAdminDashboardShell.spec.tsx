import { screen, within } from '@testing-library/react';

import type { UserSummaryDto } from '../../types/auth';
import type { MeBootstrapResponse } from '../../types/bootstrap';
import type { DashboardStatsResponse } from '../../types/dashboard';

import { mockStats, renderWithQuery, seedSession } from './dashboardTestUtils';
import { SuperAdminDashboardShell } from './SuperAdminDashboardShell';

const user: UserSummaryDto = {
  id: 'admin-1',
  email: 'admin@example.com',
  role: 'SUPER_ADMIN',
  accountType: 'ADULT',
  firstName: 'Ada',
  lastName: 'Min',
  mustChangePassword: false,
};

function bootstrap(): MeBootstrapResponse {
  return { role: 'SUPER_ADMIN', user };
}

const stats: DashboardStatsResponse = {
  role: 'SUPER_ADMIN',
  generatedAt: '2026-10-04T12:00:00.000Z',
  metrics: [
    { key: 'total_users', label: 'Total users', value: 120, unit: 'count', hint: 'Excluding deleted accounts' },
    { key: 'active_trainers', label: 'Active trainers', value: 7, unit: 'count' },
    { key: 'new_users_30d', label: 'New users', value: 9, unit: 'count', hint: 'Last 30 days', delta: { value: 4, period: 'month', direction: 'up' } },
  ],
  series: [
    {
      key: 'new_users_daily',
      label: 'New users per day',
      points: [
        { date: '2026-10-03', value: 1 },
        { date: '2026-10-04', value: 3 },
      ],
    },
  ],
};

// fe §4.3 — platform metrics (GET /dashboard/stats) + quick-link cards into
// Users / Impersonation History.
describe('SuperAdminDashboardShell', () => {
  beforeEach(() => {
    seedSession(user);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('greets the admin by first name', () => {
    mockStats(stats);
    renderWithQuery(<SuperAdminDashboardShell ctx={bootstrap()} />);

    expect(screen.getByRole('heading', { name: /welcome, ada/i })).toBeInTheDocument();
  });

  it('shows skeleton cards while the metrics load', () => {
    mockStats(stats);
    renderWithQuery(<SuperAdminDashboardShell ctx={bootstrap()} />);

    expect(screen.getAllByTestId('stat-card-skeleton').length).toBeGreaterThan(0);
  });

  it('renders the metric cards, delta pill and sparkline from the stats response', async () => {
    const fetchMock = mockStats(stats);
    renderWithQuery(<SuperAdminDashboardShell ctx={bootstrap()} />);

    expect(await screen.findByText('Total users')).toBeInTheDocument();
    expect(screen.getByText('120')).toBeInTheDocument();
    expect(screen.getByText('Active trainers')).toBeInTheDocument();
    expect(screen.getByTestId('stat-delta')).toHaveAttribute('data-direction', 'up');
    expect(screen.getByRole('img', { name: /new users per day/i })).toBeInTheDocument();
    expect(fetchMock.mock.calls[0][0]).toContain('/dashboard/stats');
  });

  it('shows an error state with a retry button when the stats request fails', async () => {
    const fetchMock = mockStats({ status: 500 });
    renderWithQuery(<SuperAdminDashboardShell ctx={bootstrap()} />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/couldn.t load your metrics/i);

    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => stats } as unknown as Response);
    within(alert).getByRole('button', { name: /retry/i }).click();

    expect(await screen.findByText('Total users')).toBeInTheDocument();
  });

  it('renders quick link cards into Users and Impersonation History only', () => {
    mockStats(stats);
    renderWithQuery(<SuperAdminDashboardShell ctx={bootstrap()} />);

    const nav = screen.getByRole('navigation', { name: /quick links/i });
    expect(within(nav).getByRole('link', { name: /users/i })).toHaveAttribute('href', '/users');
    expect(within(nav).getByRole('link', { name: /impersonation history/i })).toHaveAttribute('href', '/impersonation-history');
    expect(within(nav).getAllByRole('link')).toHaveLength(2);
  });
});
