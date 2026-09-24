import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import AvailabilityPage from './page';

jest.mock('next/navigation', () => ({
  useParams: () => ({ id: 'profile-2' }),
}));

function mockResponse(status: number, body: unknown = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    headers: new Headers(),
  } as unknown as Response;
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <AvailabilityPage />
    </QueryClientProvider>,
  );
}

// fe §4.6 — `/profiles/[id]/availability`: `<AvailabilityGrid mode="edit"
// subject="player">` over `GET/PUT /player-profiles/:id/availability`
// (api §4.5, FR-090). Task 14.7. Wrapped by `(player)/layout.tsx`'s
// RoleGuard(PLAYER_PARENT), so this leaf doesn't re-guard.
describe('AvailabilityPage (player)', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('loads the grid from GET /player-profiles/:id/availability', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(
      mockResponse(200, { playerProfileId: 'profile-2', slots: [{ dayOfWeek: 1, startTime: 17 * 60, endTime: 20 * 60, isAvailable: true }] }),
    );

    renderPage();

    await waitFor(() => expect(screen.getByLabelText(/mon start/i)).toHaveValue('17:00'));

    const [url] = (global.fetch as jest.Mock).mock.calls[0] as [string];
    expect(url).toContain('/player-profiles/profile-2/availability');
  });

  it('saves edits via PUT /player-profiles/:id/availability and shows a success message', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(mockResponse(200, { playerProfileId: 'profile-2', slots: [{ dayOfWeek: 1, startTime: 17 * 60, endTime: 20 * 60, isAvailable: true }] }))
      .mockResolvedValueOnce(
        mockResponse(200, { playerProfileId: 'profile-2', slots: [{ dayOfWeek: 1, startTime: 18 * 60, endTime: 20 * 60, isAvailable: true }] }),
      );

    renderPage();
    await waitFor(() => expect(screen.getByLabelText(/mon start/i)).toHaveValue('17:00'));

    fireEvent.change(screen.getByLabelText(/mon start/i), { target: { value: '18:00' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/saved/i));

    const [url, init] = (global.fetch as jest.Mock).mock.calls[1] as [string, RequestInit];
    expect(url).toContain('/player-profiles/profile-2/availability');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body as string)).toEqual({ slots: [{ dayOfWeek: 1, startTime: 18 * 60, endTime: 20 * 60, isAvailable: true }] });
  });

  it('shows an error state when the availability request fails', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(500));

    renderPage();

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
  });
});
