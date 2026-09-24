import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { useAuthStore } from '../../../src/stores/useAuthStore';
import type { UserSummaryDto } from '../../../src/types/auth';

import PlayersPage from './page';

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
      <PlayersPage />
    </QueryClientProvider>,
  );
}

// fe §4.4 — `/players` (trainer-side): `GET /trainers/:id/players`
// (`?dayOfWeek&startTime&endTime`) — the FR-070 narrow slice
// `{player, age, availabilitySummary}` only, no notes/tags/pipeline.
// Task 14.9. Wrapped by `(trainer)/layout.tsx`'s RoleGuard(TRAINER), so
// this leaf doesn't re-guard.
describe('PlayersPage (trainer)', () => {
  beforeEach(() => {
    useAuthStore.getState().clear();
    useAuthStore.getState().setSession({ accessToken: 't', user: trainerUser, expiresAt: Date.now() + 60_000 });
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('loads bootstrap for the own trainerId, then GET /trainers/:id/players, and renders the roster', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(mockResponse(200, bootstrapBody()))
      .mockResolvedValueOnce(
        mockResponse(200, { items: [{ playerProfileId: 'profile-1', name: 'Alex', age: 10, availabilitySummary: 'Mon 5-8pm' }], nextCursor: null, hasMore: false }),
      );

    renderPage();

    await waitFor(() => expect(screen.getByRole('row', { name: /alex/i })).toBeInTheDocument());

    const [rosterUrl] = (global.fetch as jest.Mock).mock.calls[1] as [string];
    expect(rosterUrl).toContain('/trainers/trainer-1/players');
  });

  it('re-queries with the selected day/time filter', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(mockResponse(200, bootstrapBody()))
      .mockResolvedValueOnce(mockResponse(200, { items: [], nextCursor: null, hasMore: false }))
      .mockResolvedValueOnce(mockResponse(200, { items: [], nextCursor: null, hasMore: false }));

    renderPage();
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));

    fireEvent.change(screen.getByLabelText(/day/i), { target: { value: '1' } });

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(3));
    const [filteredUrl] = (global.fetch as jest.Mock).mock.calls[2] as [string];
    expect(filteredUrl).toContain('dayOfWeek=1');
  });

  it('shows an error state when the roster request fails', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(200, bootstrapBody())).mockResolvedValueOnce(mockResponse(500));

    renderPage();

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
  });
});
