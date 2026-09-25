import { render, screen } from '@testing-library/react';

import { useAuthStore } from '../src/stores/useAuthStore';
import type { UserSummaryDto } from '../src/types/auth';

import HomePage from './page';

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

// fe §3 — the literal root `/` is never a destination in its own right; by
// the time this leaf mounts, BootSequence (Task 10.8) has already resolved
// its refresh-on-mount check, so `useAuthStore` already reflects the final
// auth state. This follows RoleGuard's own "read useAuthStore, redirect from
// an effect" pattern (RoleGuard.tsx) rather than inventing a new one.
describe('HomePage (root `/`)', () => {
  beforeEach(() => {
    useAuthStore.getState().clear();
    replaceMock.mockClear();
  });

  it('redirects to /dashboard when a session exists', () => {
    useAuthStore.getState().setSession({ accessToken: 't', user: userWithRole('TRAINER'), expiresAt: Date.now() + 60_000 });

    render(<HomePage />);

    expect(replaceMock).toHaveBeenCalledWith('/dashboard');
  });

  it('redirects to /login when there is no session', () => {
    render(<HomePage />);

    expect(replaceMock).toHaveBeenCalledWith('/login');
  });

  it('renders nothing itself — it is a pure redirect leaf', () => {
    const { container } = render(<HomePage />);

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText('PracticePerfect')).not.toBeInTheDocument();
  });
});
