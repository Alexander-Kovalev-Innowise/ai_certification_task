import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';

import { useAuthStore } from '../../src/stores/useAuthStore';
import type { UserSummaryDto } from '../../src/types/auth';

import TrainerLayout from './layout';

const replaceMock = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock }),
  usePathname: () => '/',
}));

function userWithRole(role: UserSummaryDto['role']): UserSummaryDto {
  return {
    id: 'user-1',
    email: 'trainer@example.com',
    role,
    accountType: 'ADULT',
    firstName: 'Tia',
    lastName: 'Trainer',
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
      <TrainerLayout>
        <div>page content</div>
      </TrainerLayout>
    </QueryClientProvider>,
  );
}

// fe §3 — `app/(trainer)/layout.tsx` is now ONLY RoleGuard(TRAINER) + a loading
// skeleton; the nav shell/branding live in AuthenticatedShell (see its spec).
describe('TrainerLayout', () => {
  beforeEach(() => {
    useAuthStore.getState().clear();
    replaceMock.mockClear();
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('shows a loading skeleton while bootstrap loads, then renders children for a TRAINER session', async () => {
    useAuthStore.getState().setSession({ csrfToken: 'test-csrf-token', accessToken: 't', user: userWithRole('TRAINER'), expiresAt: Date.now() + 60_000 });
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(200, { role: 'TRAINER', user: userWithRole('TRAINER') }));

    renderLayout();

    expect(screen.getByLabelText(/loading trainer portal/i)).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByText('page content')).not.toBeInTheDocument();

    await waitFor(() => expect(screen.getByText('page content')).toBeInTheDocument());
    expect(screen.queryByLabelText(/loading trainer portal/i)).not.toBeInTheDocument();
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it('does not render an app shell of its own', async () => {
    useAuthStore.getState().setSession({ csrfToken: 'test-csrf-token', accessToken: 't', user: userWithRole('TRAINER'), expiresAt: Date.now() + 60_000 });
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(200, { role: 'TRAINER', user: userWithRole('TRAINER') }));

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

  it('redirects to /dashboard and renders nothing for a non-TRAINER session', () => {
    useAuthStore.getState().setSession({ csrfToken: 'test-csrf-token', accessToken: 't', user: userWithRole('COACH'), expiresAt: Date.now() + 60_000 });

    renderLayout();

    expect(screen.queryByText('page content')).not.toBeInTheDocument();
    expect(replaceMock).toHaveBeenCalledWith('/dashboard');
  });
});
