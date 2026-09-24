import { render, screen } from '@testing-library/react';

import { useAuthStore } from '../stores/useAuthStore';
import type { UserSummaryDto } from '../types/auth';

import { RoleGuard } from './RoleGuard';

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
    firstName: 'A',
    lastName: 'B',
    mustChangePassword: false,
  };
}

describe('RoleGuard', () => {
  beforeEach(() => {
    useAuthStore.getState().clear();
    replaceMock.mockClear();
  });

  it('renders children when the session role is in the allow list', () => {
    useAuthStore.getState().setSession({ accessToken: 't', user: userWithRole('TRAINER'), expiresAt: Date.now() + 60_000 });

    render(
      <RoleGuard allow="TRAINER">
        <div>trainer content</div>
      </RoleGuard>,
    );

    expect(screen.getByText('trainer content')).toBeInTheDocument();
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it('accepts an array of allowed roles', () => {
    useAuthStore.getState().setSession({ accessToken: 't', user: userWithRole('COACH'), expiresAt: Date.now() + 60_000 });

    render(
      <RoleGuard allow={['TRAINER', 'COACH']}>
        <div>multi-role content</div>
      </RoleGuard>,
    );

    expect(screen.getByText('multi-role content')).toBeInTheDocument();
  });

  it('redirects to /login and renders nothing when there is no session', () => {
    render(
      <RoleGuard allow="TRAINER">
        <div>should not render</div>
      </RoleGuard>,
    );

    expect(screen.queryByText('should not render')).not.toBeInTheDocument();
    expect(replaceMock).toHaveBeenCalledWith('/login');
  });

  it("redirects to /dashboard and renders nothing when the session's role isn't allowed", () => {
    useAuthStore.getState().setSession({ accessToken: 't', user: userWithRole('COACH'), expiresAt: Date.now() + 60_000 });

    render(
      <RoleGuard allow="TRAINER">
        <div>should not render</div>
      </RoleGuard>,
    );

    expect(screen.queryByText('should not render')).not.toBeInTheDocument();
    expect(replaceMock).toHaveBeenCalledWith('/dashboard');
  });
});
