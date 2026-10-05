import { fireEvent, render, screen } from '@testing-library/react';

import { useAuthStore } from '../../stores/useAuthStore';

import { AppShell } from './AppShell';

jest.mock('next/navigation', () => ({
  usePathname: () => '/users',
  useRouter: () => ({ replace: jest.fn() }),
}));

const LINKS = [
  { href: '/dashboard', label: 'Dashboard', icon: 'home' },
  { href: '/users', label: 'Users', icon: 'users' },
] as const;

function renderShell() {
  return render(
    <AppShell navLabel="Test navigation" links={LINKS}>
      <p>content</p>
    </AppShell>,
  );
}

describe('AppShell sidebar', () => {
  beforeEach(() => {
    window.localStorage.clear();
    useAuthStore.getState().clear();
  });

  it('marks the current route and renders an Account link last', () => {
    renderShell();

    expect(screen.getByRole('link', { name: 'Users' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Dashboard' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'Account' })).toHaveAttribute('href', '/account/profile');
  });

  it('collapses to an icon rail that keeps accessible names, and expands again', () => {
    const { container } = renderShell();
    const aside = container.querySelector('aside')!;
    expect(aside).toHaveAttribute('data-collapsed', 'false');

    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));

    expect(aside).toHaveAttribute('data-collapsed', 'true');
    expect(screen.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('title', 'Dashboard');
    expect(window.localStorage.getItem('pp.sidebar.collapsed')).toBe('1');

    fireEvent.click(screen.getByRole('button', { name: 'Expand sidebar' }));
    expect(aside).toHaveAttribute('data-collapsed', 'false');
    expect(window.localStorage.getItem('pp.sidebar.collapsed')).toBe('0');
  });

  it('shows the user photo thumbnail in the user pill when the session has one, initials otherwise', () => {
    const user = { id: 'u1', email: 'a@b.c', role: 'TRAINER', accountType: 'ADULT', firstName: 'Ada', lastName: 'Lovelace', mustChangePassword: false } as const;
    const session = { accessToken: 't', expiresAt: Date.now() + 60_000, csrfToken: 'c' };

    useAuthStore.getState().setSession({ ...session, user });
    const { unmount } = renderShell();
    expect(screen.getByText('AL')).toBeInTheDocument();
    unmount();

    useAuthStore.getState().setSession({ ...session, user: { ...user, photoUrl: 'http://localhost:3000/uploads/photo-abc.webp' } });
    const { container } = renderShell();
    expect(screen.queryByText('AL')).not.toBeInTheDocument();
    expect(container.querySelector('img[src="http://localhost:3000/uploads/photo-abc-thumb.webp"]')).not.toBeNull();
  });
});
