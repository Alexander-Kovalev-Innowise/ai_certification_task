import { render, screen } from '@testing-library/react';

import type { UserSummaryDto } from '../../types/auth';
import type { MeBootstrapResponse } from '../../types/bootstrap';

import { SuperAdminDashboardShell } from './SuperAdminDashboardShell';

function bootstrap(): MeBootstrapResponse {
  const user: UserSummaryDto = {
    id: 'admin-1',
    email: 'admin@example.com',
    role: 'SUPER_ADMIN',
    accountType: 'ADULT',
    firstName: 'Ada',
    lastName: 'Min',
    mustChangePassword: false,
  };
  return { role: 'SUPER_ADMIN', user };
}

// fe §4.3 — SuperAdminDashboardShell: deliberately sparse (api §5, no stats
// block in Epic-01), quick links into Users / Impersonation History only.
// Task 12.2.
describe('SuperAdminDashboardShell', () => {
  it("greets the admin by first name", () => {
    render(<SuperAdminDashboardShell ctx={bootstrap()} />);

    expect(screen.getByRole('heading', { name: /welcome, ada/i })).toBeInTheDocument();
  });

  it('renders quick links into Users and Impersonation History only', () => {
    render(<SuperAdminDashboardShell ctx={bootstrap()} />);

    expect(screen.getByRole('link', { name: /users/i })).toHaveAttribute('href', '/users');
    expect(screen.getByRole('link', { name: /impersonation history/i })).toHaveAttribute('href', '/impersonation-history');
    expect(screen.getAllByRole('link')).toHaveLength(2);
  });
});
