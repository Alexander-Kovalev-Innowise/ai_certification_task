import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { useAuthStore } from '../../../src/stores/useAuthStore';
import type { UserSummaryDto } from '../../../src/types/auth';

import CoachesPage from './page';

function mockResponse(status: number, body: unknown = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    headers: new Headers(),
  } as unknown as Response;
}

const trainerUser: UserSummaryDto = {
  id: 'user-1',
  email: 'trainer@example.com',
  role: 'TRAINER',
  accountType: 'ADULT',
  firstName: 'Tia',
  lastName: 'Trainer',
  mustChangePassword: false,
};

function bootstrapBody() {
  return {
    role: 'TRAINER',
    user: trainerUser,
    trainerProfile: { id: 'trainer-1', businessName: 'Ace Tennis' },
    branding: { logoUrl: null, primaryColorHex: null },
    coachCount: 1,
    activePlayerCount: 3,
  };
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <CoachesPage />
    </QueryClientProvider>,
  );
}

// fe §4.4 — `/coaches`: GET /trainers/:id/coaches (own trainerId from
// bootstrap) + invite form (POST /coaches/invite) + PATCH /coaches/:id
// (status) + resend-on-expiry. Task 13.2. Wrapped by
// `(trainer)/layout.tsx`'s RoleGuard(TRAINER), so this leaf doesn't re-guard.
describe('CoachesPage', () => {
  beforeEach(() => {
    useAuthStore.getState().clear();
    useAuthStore.getState().setSession({ accessToken: 't', user: trainerUser, expiresAt: Date.now() + 60_000 });
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('loads bootstrap for the own trainerId, then GET /trainers/:id/coaches, and renders the roster', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(mockResponse(200, bootstrapBody()))
      .mockResolvedValueOnce(
        mockResponse(200, {
          items: [
            { id: 'coach-1', userId: 'u1', name: 'Cam Coach', email: 'cam@example.com', status: 'ACTIVE', bio: null, joinedAt: '2026-01-01T00:00:00.000Z', invitationStatus: 'Accepted' },
          ],
          nextCursor: null,
          hasMore: false,
        }),
      );

    renderPage();

    await waitFor(() => expect(screen.getByRole('row', { name: /cam coach/i })).toBeInTheDocument());

    const [rosterUrl] = (global.fetch as jest.Mock).mock.calls[1] as [string];
    expect(rosterUrl).toContain('/trainers/trainer-1/coaches');
  });

  it('opens InviteCoachModal from the "Invite Coach" button and refetches the roster on success', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(mockResponse(200, bootstrapBody()))
      .mockResolvedValueOnce(mockResponse(200, { items: [], nextCursor: null, hasMore: false }))
      .mockResolvedValueOnce(mockResponse(201, { shareLinkCode: 'abc123', expiresAt: '2026-02-01T00:00:00.000Z', status: 'PENDING' }))
      .mockResolvedValueOnce(mockResponse(200, { items: [], nextCursor: null, hasMore: false }));

    renderPage();
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));

    fireEvent.click(screen.getByRole('button', { name: /invite coach/i }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/^email/i), { target: { value: 'cam@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /send invite/i }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(4));
  });

  it('shows an error state when the roster request fails', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(200, bootstrapBody())).mockResolvedValueOnce(mockResponse(500));

    renderPage();

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
  });
});
