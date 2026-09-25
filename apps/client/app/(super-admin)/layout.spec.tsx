import { render, screen } from '@testing-library/react';

import { useAuthStore } from '../../src/stores/useAuthStore';
import type { UserSummaryDto } from '../../src/types/auth';

import SuperAdminLayout from './layout';

const replaceMock = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock }),
}));

function userWithRole(role: UserSummaryDto['role']): UserSummaryDto {
  return {
    id: 'user-1',
    email: 'admin@example.com',
    role,
    accountType: 'ADULT',
    firstName: 'Ada',
    lastName: 'Min',
    mustChangePassword: false,
  };
}

// fe §3 route map — `(super-admin)/layout.tsx`: RoleGuard(SUPER_ADMIN) + SA
// nav shell (Users, Impersonation History links). Task 12.1.
describe('SuperAdminLayout', () => {
  beforeEach(() => {
    useAuthStore.getState().clear();
    replaceMock.mockClear();
  });

  it('renders the SA nav shell with Users and Impersonation History links plus children for a SUPER_ADMIN session', () => {
    useAuthStore.getState().setSession({ accessToken: 't', user: userWithRole('SUPER_ADMIN'), expiresAt: Date.now() + 60_000 });

    render(
      <SuperAdminLayout>
        <div>page content</div>
      </SuperAdminLayout>,
    );

    expect(screen.getByRole('link', { name: /users/i })).toHaveAttribute('href', '/users');
    expect(screen.getByRole('link', { name: /impersonation history/i })).toHaveAttribute('href', '/impersonation-history');
    expect(screen.getByRole('link', { name: /^account$/i })).toHaveAttribute('href', '/account/profile');
    expect(screen.getByText('page content')).toBeInTheDocument();
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it('redirects to /login and renders nothing when there is no session', () => {
    render(
      <SuperAdminLayout>
        <div>page content</div>
      </SuperAdminLayout>,
    );

    expect(screen.queryByText('page content')).not.toBeInTheDocument();
    expect(replaceMock).toHaveBeenCalledWith('/login');
  });

  it("redirects to /dashboard and renders nothing for a non-SUPER_ADMIN session", () => {
    useAuthStore.getState().setSession({ accessToken: 't', user: userWithRole('TRAINER'), expiresAt: Date.now() + 60_000 });

    render(
      <SuperAdminLayout>
        <div>page content</div>
      </SuperAdminLayout>,
    );

    expect(screen.queryByText('page content')).not.toBeInTheDocument();
    expect(replaceMock).toHaveBeenCalledWith('/dashboard');
  });
});
