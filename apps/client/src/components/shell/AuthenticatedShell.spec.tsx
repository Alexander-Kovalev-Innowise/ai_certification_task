import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

import { useAuthStore } from '../../stores/useAuthStore';
import type { UserSummaryDto } from '../../types/auth';

import { AuthenticatedShell } from './AuthenticatedShell';

let mockPathname: string | null = '/dashboard';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: jest.fn() }),
  usePathname: () => mockPathname,
}));

function userWithRole(role: UserSummaryDto['role'], accountType: UserSummaryDto['accountType'] = 'ADULT'): UserSummaryDto {
  return {
    id: 'user-1',
    email: 'user@example.com',
    role,
    accountType,
    firstName: 'Alex',
    lastName: 'B',
    mustChangePassword: false,
  };
}

function mockResponse(status: number, body: unknown = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    headers: new Headers(),
  } as unknown as Response;
}

function signIn(user: UserSummaryDto) {
  useAuthStore.getState().setSession({ csrfToken: 'test-csrf-token', accessToken: 't', user, expiresAt: Date.now() + 60_000 });
}

function tree(queryClient: QueryClient): ReactNode {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthenticatedShell>
        <div>page content</div>
      </AuthenticatedShell>
    </QueryClientProvider>
  );
}

function renderShell() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const result = render(tree(queryClient));
  return { ...result, rerenderShell: () => result.rerender(tree(queryClient)) };
}

const CONTEXT = {
  playerProfileId: 'profile-1',
  playerProfileName: 'Priya',
  isSelf: true,
  trainerId: 'trainer-1',
  trainerDisplayName: 'Coach Lisa',
  logoUrl: null,
  primaryColorHex: '#112233',
  connectedAt: '2026-01-01T00:00:00.000Z',
};

describe('AuthenticatedShell', () => {
  beforeEach(() => {
    useAuthStore.getState().clear();
    mockPathname = '/dashboard';
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('when the shell does not apply', () => {
    it.each(['/', '/login', '/register', '/forgot-password', '/reset-password', '/verify-email', '/change-password', '/join/ABC123'])(
      'renders only the children on %s, with no nav and no bootstrap fetch, even when signed in',
      (path) => {
        mockPathname = path;
        signIn(userWithRole('TRAINER'));

        const { container } = renderShell();

        expect(screen.getByText('page content')).toBeInTheDocument();
        expect(container.querySelector('nav')).toBeNull();
        expect(container.querySelector('[data-branding]')).toBeNull();
        expect(global.fetch).not.toHaveBeenCalled();
      },
    );

    it('renders only the children when signed out', () => {
      const { container } = renderShell();

      expect(screen.getByText('page content')).toBeInTheDocument();
      expect(container.querySelector('nav')).toBeNull();
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('renders only the children when the pathname is unavailable', () => {
      mockPathname = null;
      signIn(userWithRole('TRAINER'));

      const { container } = renderShell();

      expect(screen.getByText('page content')).toBeInTheDocument();
      expect(container.querySelector('nav')).toBeNull();
    });
  });

  describe('TRAINER', () => {
    it('renders nav links before bootstrap resolves, then applies the trainer branding', async () => {
      signIn(userWithRole('TRAINER'));
      (global.fetch as jest.Mock).mockResolvedValueOnce(
        mockResponse(200, {
          role: 'TRAINER',
          user: userWithRole('TRAINER'),
          trainerProfile: { id: 'trainer-1', businessName: 'Ace Tennis' },
          branding: { logoUrl: 'https://cdn.example.com/logo.png', primaryColorHex: '#112233' },
          coachCount: 2,
          activePlayerCount: 10,
        }),
      );

      const { container } = renderShell();

      // Known immediately from the auth store, before bootstrap resolves.
      expect(screen.getByRole('navigation', { name: /trainer navigation/i })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /^dashboard$/i })).toHaveAttribute('href', '/dashboard');
      expect(screen.getByRole('link', { name: /^coaches$/i })).toHaveAttribute('href', '/coaches');
      expect(screen.getByRole('link', { name: /^players$/i })).toHaveAttribute('href', '/players');
      expect(screen.getByRole('link', { name: /share links/i })).toHaveAttribute('href', '/share-links');
      expect(screen.getByRole('link', { name: /^branding$/i })).toHaveAttribute('href', '/branding');
      expect(screen.getByRole('link', { name: /^account$/i })).toHaveAttribute('href', '/account/profile');
      expect(screen.getByText('page content')).toBeInTheDocument();

      await waitFor(() => expect(container.querySelector('[data-branding]')).toHaveStyle({ '--brand-primary': '#112233' }));
      expect(screen.getByRole('img', { name: /portal logo/i })).toHaveAttribute('src', 'https://cdn.example.com/logo.png');
    });
  });

  describe('COACH', () => {
    it('renders the coach nav and applies the employing trainer branding', async () => {
      mockPathname = '/my-times';
      signIn(userWithRole('COACH'));
      (global.fetch as jest.Mock).mockResolvedValueOnce(
        mockResponse(200, {
          role: 'COACH',
          user: userWithRole('COACH'),
          coachProfile: { id: 'coach-1', userId: 'user-1', trainerId: 'trainer-1', status: 'ACTIVE', bio: null, credentials: null, certifications: null, publicProfile: false },
          employingTrainer: { id: 'trainer-1', businessName: 'Ace Tennis', logoUrl: 'https://cdn.example.com/logo.png', primaryColorHex: '#112233' },
          availabilitySet: true,
        }),
      );

      const { container } = renderShell();

      expect(screen.getByRole('navigation', { name: /coach navigation/i })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /^dashboard$/i })).toHaveAttribute('href', '/dashboard');
      expect(screen.getByRole('link', { name: /my times/i })).toHaveAttribute('href', '/my-times');
      expect(screen.getByRole('link', { name: /^profile$/i })).toHaveAttribute('href', '/profile');
      expect(screen.getByRole('link', { name: /^account$/i })).toHaveAttribute('href', '/account/profile');

      await waitFor(() => expect(container.querySelector('[data-branding]')).toHaveStyle({ '--brand-primary': '#112233' }));
    });
  });

  describe('SUPER_ADMIN', () => {
    it('renders the super admin nav with no tenant branding', async () => {
      mockPathname = '/users';
      signIn(userWithRole('SUPER_ADMIN'));
      (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(200, { role: 'SUPER_ADMIN', user: userWithRole('SUPER_ADMIN') }));

      const { container } = renderShell();

      expect(screen.getByRole('navigation', { name: /super admin navigation/i })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /^dashboard$/i })).toHaveAttribute('href', '/dashboard');
      expect(screen.getByRole('link', { name: /^users$/i })).toHaveAttribute('href', '/users');
      expect(screen.getByRole('link', { name: /impersonation history/i })).toHaveAttribute('href', '/impersonation-history');
      expect(screen.getByRole('link', { name: /^account$/i })).toHaveAttribute('href', '/account/profile');

      await waitFor(() => expect(global.fetch).toHaveBeenCalled());
      expect(container.querySelector('[data-branding]')).toHaveStyle({ '--brand-primary': '#00B300' });
    });
  });

  describe('PLAYER_PARENT', () => {
    it('mounts the ContextSwitcher and the Approvals link from bootstrap and applies the active context branding', async () => {
      mockPathname = '/profiles';
      signIn(userWithRole('PLAYER_PARENT'));
      (global.fetch as jest.Mock).mockResolvedValueOnce(
        mockResponse(200, {
          role: 'PLAYER_PARENT',
          accountType: 'ADULT',
          user: userWithRole('PLAYER_PARENT'),
          playerProfiles: [],
          contexts: [CONTEXT],
          activeContext: CONTEXT,
          pendingApprovalsCount: 0,
        }),
      );

      const { container } = renderShell();

      // Before bootstrap: nav is already there, Approvals not yet.
      expect(screen.getByRole('navigation', { name: /player\/parent navigation/i })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /^dashboard$/i })).toHaveAttribute('href', '/dashboard');
      expect(screen.getByRole('link', { name: /^profiles$/i })).toHaveAttribute('href', '/profiles');
      expect(screen.queryByRole('link', { name: /approvals/i })).not.toBeInTheDocument();

      await waitFor(() => expect(screen.getByLabelText(/active trainer context/i)).toBeInTheDocument());
      expect(screen.getByRole('link', { name: /approvals/i })).toHaveAttribute('href', '/approvals');
      expect(screen.queryByRole('link', { name: /my requests/i })).not.toBeInTheDocument();
      expect(screen.getByRole('link', { name: /^account$/i })).toHaveAttribute('href', '/account/profile');
      expect(container.querySelector('[data-branding]')).toHaveStyle({ '--brand-primary': '#112233' });
    });

    // fe §4.6/§9.4 — Approvals is adult-parent-only (APPROVE_CHILD_PURCHASE is
    // CHILD-denied, api §4.6); hidden entirely for a CHILD session. Task 14.8.
    it('hides the Approvals nav item for a CHILD session', async () => {
      mockPathname = '/profiles';
      signIn(userWithRole('PLAYER_PARENT', 'CHILD'));
      (global.fetch as jest.Mock).mockResolvedValueOnce(
        mockResponse(200, {
          role: 'PLAYER_PARENT',
          accountType: 'CHILD',
          user: userWithRole('PLAYER_PARENT', 'CHILD'),
          playerProfile: { id: 'profile-2', name: 'Alex', isSelf: false, trainerCount: 1 },
          contexts: [],
          activeContext: null,
        }),
      );

      renderShell();

      await waitFor(() => expect(screen.getByLabelText(/active trainer context/i)).toBeInTheDocument());
      expect(screen.queryByRole('link', { name: /approvals/i })).not.toBeInTheDocument();
      // ...and gets its own "My requests" link instead.
      expect(screen.getByRole('link', { name: /my requests/i })).toHaveAttribute('href', '/requests');
      expect(screen.getByRole('link', { name: /^account$/i })).toHaveAttribute('href', '/account/profile');
    });
  });

  describe('active link', () => {
    it.each([
      ['/dashboard', /^dashboard$/i],
      ['/coaches', /^coaches$/i],
      ['/account/profile', /^account$/i],
      ['/account/profile/security', /^account$/i],
    ])('marks the matching nav item current on %s', (path, name) => {
      mockPathname = path;
      signIn(userWithRole('TRAINER'));
      (global.fetch as jest.Mock).mockReturnValue(new Promise(() => undefined));

      renderShell();

      expect(screen.getByRole('link', { name })).toHaveAttribute('aria-current', 'page');
    });
  });

  describe('persistence across navigation', () => {
    it('keeps the very same shell DOM node when the pathname changes between role layouts', async () => {
      signIn(userWithRole('SUPER_ADMIN'));
      (global.fetch as jest.Mock).mockResolvedValue(mockResponse(200, { role: 'SUPER_ADMIN', user: userWithRole('SUPER_ADMIN') }));

      mockPathname = '/dashboard';
      const { container, rerenderShell } = renderShell();
      await waitFor(() => expect(global.fetch).toHaveBeenCalled());

      const sidebarBefore = container.querySelector('aside');
      const brandingBefore = container.querySelector('[data-branding]');
      expect(sidebarBefore).not.toBeNull();
      expect(screen.getByRole('link', { name: /^dashboard$/i })).toHaveAttribute('aria-current', 'page');

      mockPathname = '/users';
      rerenderShell();

      expect(container.querySelector('aside')).toBe(sidebarBefore);
      expect(container.querySelector('[data-branding]')).toBe(brandingBefore);
      expect(screen.getByRole('link', { name: /^users$/i })).toHaveAttribute('aria-current', 'page');
      expect(screen.getByRole('link', { name: /^dashboard$/i })).not.toHaveAttribute('aria-current');
    });

    it('does not remount the shell when bootstrap data arrives', async () => {
      signIn(userWithRole('TRAINER'));
      (global.fetch as jest.Mock).mockResolvedValueOnce(
        mockResponse(200, {
          role: 'TRAINER',
          user: userWithRole('TRAINER'),
          trainerProfile: { id: 'trainer-1', businessName: 'Ace Tennis' },
          branding: { logoUrl: null, primaryColorHex: '#112233' },
          coachCount: 0,
          activePlayerCount: 0,
        }),
      );

      const { container } = renderShell();
      const sidebarBefore = container.querySelector('aside');

      await waitFor(() => expect(container.querySelector('[data-branding]')).toHaveStyle({ '--brand-primary': '#112233' }));

      expect(container.querySelector('aside')).toBe(sidebarBefore);
    });
  });
});
