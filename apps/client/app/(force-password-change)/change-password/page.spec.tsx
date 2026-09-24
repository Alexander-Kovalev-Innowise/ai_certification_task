import { render, screen } from '@testing-library/react';

import { useAuthStore } from '../../../src/stores/useAuthStore';
import type { UserSummaryDto } from '../../../src/types/auth';

import ChangePasswordPage from './page';

const replaceMock = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock, push: jest.fn() }),
}));

const testUser: UserSummaryDto = {
  id: 'user-1',
  email: 'user@example.com',
  role: 'TRAINER',
  accountType: 'ADULT',
  firstName: 'A',
  lastName: 'B',
  mustChangePassword: true,
};

describe('ChangePasswordPage', () => {
  beforeEach(() => {
    useAuthStore.getState().clear();
    replaceMock.mockClear();
  });

  it('redirects to /login and renders nothing when there is no session', () => {
    render(<ChangePasswordPage />);

    expect(replaceMock).toHaveBeenCalledWith('/login');
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
  });

  it('renders the forced-landing heading and form when a session exists', () => {
    useAuthStore.getState().setSession({ accessToken: 't', user: testUser, expiresAt: Date.now() + 60_000 });

    render(<ChangePasswordPage />);

    expect(screen.getByText('Set a new password to continue')).toBeInTheDocument();
    expect(replaceMock).not.toHaveBeenCalled();
  });
});
