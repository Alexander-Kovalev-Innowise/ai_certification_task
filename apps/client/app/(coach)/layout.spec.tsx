import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';

import { useAuthStore } from '../../src/stores/useAuthStore';
import type { UserSummaryDto } from '../../src/types/auth';

import CoachLayout from './layout';

const replaceMock = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock }),
}));

function userWithRole(role: UserSummaryDto['role']): UserSummaryDto {
  return {
    id: 'user-1',
    email: 'coach@example.com',
    role,
    accountType: 'ADULT',
    firstName: 'Cory',
    lastName: 'Coach',
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
      <CoachLayout>
        <div>page content</div>
      </CoachLayout>
    </QueryClientProvider>,
  );
}

// fe §3/§4.5 — `(coach)/layout.tsx`: RoleGuard(COACH), coach nav shell
// (My Times, Profile), BrandingProvider reads the employing trainer's
// branding off `CoachBootstrapDto.employingTrainer` (BrandingProvider.tsx's
// own doc comment lists this as one of the real shapes it's fed). Task 15.1.
describe('CoachLayout', () => {
  beforeEach(() => {
    useAuthStore.getState().clear();
    replaceMock.mockClear();
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('renders the coach nav shell with My Times/Profile links, applies employing-trainer branding, and renders children for a COACH session', async () => {
    useAuthStore.getState().setSession({ accessToken: 't', user: userWithRole('COACH'), expiresAt: Date.now() + 60_000 });
    (global.fetch as jest.Mock).mockResolvedValueOnce(
      mockResponse(200, {
        role: 'COACH',
        user: userWithRole('COACH'),
        coachProfile: { id: 'coach-1', userId: 'user-1', trainerId: 'trainer-1', status: 'ACTIVE', bio: null, credentials: null, certifications: null, publicProfile: false },
        employingTrainer: { id: 'trainer-1', businessName: 'Ace Tennis', logoUrl: 'https://cdn.example.com/logo.png', primaryColorHex: '#112233' },
        availabilitySet: true,
      }),
    );

    const { container } = renderLayout();

    expect(screen.getByRole('link', { name: /my times/i })).toHaveAttribute('href', '/my-times');
    expect(screen.getByRole('link', { name: /profile/i })).toHaveAttribute('href', '/profile');

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

  it('redirects to /dashboard and renders nothing for a non-COACH session', () => {
    useAuthStore.getState().setSession({ accessToken: 't', user: userWithRole('TRAINER'), expiresAt: Date.now() + 60_000 });

    renderLayout();

    expect(screen.queryByText('page content')).not.toBeInTheDocument();
    expect(replaceMock).toHaveBeenCalledWith('/dashboard');
  });
});
