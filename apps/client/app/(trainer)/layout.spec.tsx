import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';

import { useAuthStore } from '../../src/stores/useAuthStore';
import type { UserSummaryDto } from '../../src/types/auth';

import TrainerLayout from './layout';

const replaceMock = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock }),
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

// fe §3/§4.4 — `(trainer)/layout.tsx`: RoleGuard(TRAINER), trainer nav shell,
// BrandingProvider reads own trainerProfile/branding from GET /me/bootstrap.
// Task 13.1.
describe('TrainerLayout', () => {
  beforeEach(() => {
    useAuthStore.getState().clear();
    replaceMock.mockClear();
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('renders the trainer nav shell with Coaches/Share Links links, applies branding from bootstrap, and renders children for a TRAINER session', async () => {
    useAuthStore.getState().setSession({ accessToken: 't', user: userWithRole('TRAINER'), expiresAt: Date.now() + 60_000 });
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

    const { container } = renderLayout();

    expect(screen.getByRole('link', { name: /coaches/i })).toHaveAttribute('href', '/coaches');
    expect(screen.getByRole('link', { name: /share links/i })).toHaveAttribute('href', '/share-links');

    await waitFor(() => expect(screen.getByText('page content')).toBeInTheDocument());
    expect(replaceMock).not.toHaveBeenCalled();

    const brandingEl = container.querySelector('[data-branding]');
    expect(brandingEl).toHaveStyle({ '--brand-primary': '#112233' });
  });

  it('redirects to /login and renders nothing when there is no session', () => {
    renderLayout();

    expect(screen.queryByText('page content')).not.toBeInTheDocument();
    expect(replaceMock).toHaveBeenCalledWith('/login');
  });

  it('redirects to /dashboard and renders nothing for a non-TRAINER session', () => {
    useAuthStore.getState().setSession({ accessToken: 't', user: userWithRole('COACH'), expiresAt: Date.now() + 60_000 });

    renderLayout();

    expect(screen.queryByText('page content')).not.toBeInTheDocument();
    expect(replaceMock).toHaveBeenCalledWith('/dashboard');
  });
});
