import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';

import { useAuthStore } from '../../src/stores/useAuthStore';
import type { UserSummaryDto } from '../../src/types/auth';

import SuperAdminLayout from './layout';

const replaceMock = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock }),
  usePathname: () => '/',
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

function mockResponse(status: number, body: unknown = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    headers: new Headers(),
  } as unknown as Response;
}

function renderLayout() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <SuperAdminLayout>
        <div>page content</div>
      </SuperAdminLayout>
    </QueryClientProvider>,
  );
}

// fe §3 — `app/(super-admin)/layout.tsx` is now ONLY RoleGuard(SUPER_ADMIN) + a loading
// skeleton; the nav shell/branding live in AuthenticatedShell (see its spec).
describe('SuperAdminLayout', () => {
  beforeEach(() => {
    useAuthStore.getState().clear();
    replaceMock.mockClear();
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('shows a loading skeleton while bootstrap loads, then renders children for a SUPER_ADMIN session', async () => {
    useAuthStore.getState().setSession({ csrfToken: 'test-csrf-token', accessToken: 't', user: userWithRole('SUPER_ADMIN'), expiresAt: Date.now() + 60_000 });
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(200, { role: 'SUPER_ADMIN', user: userWithRole('SUPER_ADMIN') }));

    renderLayout();

    expect(screen.getByLabelText(/loading super admin portal/i)).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByText('page content')).not.toBeInTheDocument();

    await waitFor(() => expect(screen.getByText('page content')).toBeInTheDocument());
    expect(screen.queryByLabelText(/loading super admin portal/i)).not.toBeInTheDocument();
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it('does not render an app shell of its own', async () => {
    useAuthStore.getState().setSession({ csrfToken: 'test-csrf-token', accessToken: 't', user: userWithRole('SUPER_ADMIN'), expiresAt: Date.now() + 60_000 });
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(200, { role: 'SUPER_ADMIN', user: userWithRole('SUPER_ADMIN') }));

    const { container } = renderLayout();

    await waitFor(() => expect(screen.getByText('page content')).toBeInTheDocument());
    expect(container.querySelector('nav')).toBeNull();
    expect(container.querySelector('[data-branding]')).toBeNull();
  });

  it('redirects to /login and renders nothing when there is no session', () => {
    renderLayout();

    expect(screen.queryByText('page content')).not.toBeInTheDocument();
    expect(replaceMock).toHaveBeenCalledWith('/login');
  });

  it('redirects to /dashboard and renders nothing for a non-SUPER_ADMIN session', () => {
    useAuthStore.getState().setSession({ csrfToken: 'test-csrf-token', accessToken: 't', user: userWithRole('TRAINER'), expiresAt: Date.now() + 60_000 });

    renderLayout();

    expect(screen.queryByText('page content')).not.toBeInTheDocument();
    expect(replaceMock).toHaveBeenCalledWith('/dashboard');
  });
});
