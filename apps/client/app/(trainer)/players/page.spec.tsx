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
    useAuthStore.getState().setSession({ csrfToken: 'test-csrf-token', accessToken: 't', user: trainerUser, expiresAt: Date.now() + 60_000 });
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

    // Filter changes are debounced (300ms) before they reach the query key.
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(3));
    const [filteredUrl] = (global.fetch as jest.Mock).mock.calls[2] as [string];
    expect(filteredUrl).toContain('dayOfWeek=1');
  });

  it('keeps the previous rows (no skeleton flash) until the new filter data arrives', async () => {
    let resolveFiltered: (value: Response) => void = () => undefined;
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(mockResponse(200, bootstrapBody()))
      .mockResolvedValueOnce(
        mockResponse(200, { items: [{ playerProfileId: 'profile-1', name: 'Alex', age: 10, availabilitySummary: 'Mon 5-8pm' }], nextCursor: null, hasMore: false }),
      )
      .mockReturnValueOnce(new Promise<Response>((resolve) => (resolveFiltered = resolve)));

    renderPage();
    await waitFor(() => expect(screen.getByRole('row', { name: /alex/i })).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText(/day/i), { target: { value: '1' } });
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(3));

    expect(screen.getByRole('row', { name: /alex/i })).toBeInTheDocument();
    expect(screen.queryByRole('table', { name: /loading player roster/i })).not.toBeInTheDocument();

    resolveFiltered(mockResponse(200, { items: [], nextCursor: null, hasMore: false }));
    await waitFor(() => expect(screen.queryByRole('row', { name: /alex/i })).not.toBeInTheDocument());
  });

  it('issues a single fetch for rapid successive filter changes', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(mockResponse(200, bootstrapBody()))
      .mockResolvedValue(mockResponse(200, { items: [], nextCursor: null, hasMore: false }));

    renderPage();
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));

    fireEvent.change(screen.getByLabelText(/day/i), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText(/day/i), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText(/day/i), { target: { value: '3' } });

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(3));
    await new Promise((resolve) => setTimeout(resolve, 450));

    expect(global.fetch).toHaveBeenCalledTimes(3);
    const [filteredUrl] = (global.fetch as jest.Mock).mock.calls[2] as [string];
    expect(filteredUrl).toContain('dayOfWeek=3');
  });

  it('shows an error state when the roster request fails', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(200, bootstrapBody())).mockResolvedValueOnce(mockResponse(500));

    renderPage();

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
  });

  it('shows "Players available at this time: X out of Y" only while a day/time filter is active (US-01.09)', async () => {
    const row = { playerProfileId: 'profile-1', name: 'Alex', age: 10, availabilitySummary: 'Mon 5-8pm' };
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(mockResponse(200, bootstrapBody()))
      .mockResolvedValueOnce(mockResponse(200, { items: [row], nextCursor: null, hasMore: false, availableCount: 3, totalCount: 3 }))
      .mockResolvedValueOnce(mockResponse(200, { items: [row], nextCursor: null, hasMore: false, availableCount: 1, totalCount: 3 }));

    renderPage();
    await waitFor(() => expect(screen.getByRole('row', { name: /alex/i })).toBeInTheDocument());
    expect(screen.queryByText(/players available at this time/i)).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/day/i), { target: { value: '1' } });

    await waitFor(() => expect(screen.getByText(/players available at this time/i)).toHaveTextContent('Players available at this time: 1 out of 3'));
  });

  it('removes a player after confirmation (DELETE /trainers/:id/players/:playerProfileId) and refreshes the roster', async () => {
    const row = { playerProfileId: 'profile-1', name: 'Alex', age: 10, availabilitySummary: 'Mon 5-8pm' };
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(mockResponse(200, bootstrapBody()))
      .mockResolvedValueOnce(mockResponse(200, { items: [row], nextCursor: null, hasMore: false, availableCount: 1, totalCount: 1 }))
      .mockResolvedValueOnce(mockResponse(204))
      .mockResolvedValue(mockResponse(200, { items: [], nextCursor: null, hasMore: false, availableCount: 0, totalCount: 0 }));

    renderPage();
    await waitFor(() => expect(screen.getByRole('row', { name: /alex/i })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Remove Alex' }));
    expect(screen.getByRole('dialog')).toHaveTextContent(/removed from your roster/i);
    fireEvent.click(screen.getByRole('button', { name: 'Remove player' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    const deleteCall = (global.fetch as jest.Mock).mock.calls.find((call) => (call[1] as RequestInit | undefined)?.method === 'DELETE') as [string, RequestInit];
    expect(deleteCall[0]).toContain('/trainers/trainer-1/players/profile-1');
    await waitFor(() => expect(screen.queryByRole('row', { name: /alex/i })).not.toBeInTheDocument());
  });

  it('keeps the confirm dialog open with an error when the removal fails', async () => {
    const row = { playerProfileId: 'profile-1', name: 'Alex', age: 10, availabilitySummary: 'Mon 5-8pm' };
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(mockResponse(200, bootstrapBody()))
      .mockResolvedValueOnce(mockResponse(200, { items: [row], nextCursor: null, hasMore: false, availableCount: 1, totalCount: 1 }))
      .mockResolvedValueOnce(mockResponse(500));

    renderPage();
    await waitFor(() => expect(screen.getByRole('row', { name: /alex/i })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Remove Alex' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove player' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not remove/i);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
