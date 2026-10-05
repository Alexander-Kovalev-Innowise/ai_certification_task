import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import AvailabilityPage from './page';

const pushMock = jest.fn();

jest.mock('next/navigation', () => ({
  useParams: () => ({ id: 'profile-2' }),
  useRouter: () => ({ push: pushMock }),
}));

const PROFILES = [
  { id: 'profile-1', name: 'Priya', isSelf: true, trainerCount: 1, photoUrl: null },
  { id: 'profile-2', name: 'Alex', isSelf: false, trainerCount: 1, photoUrl: null },
  { id: 'profile-3', name: 'Leo', isSelf: false, trainerCount: 0, photoUrl: null },
];

// Routes fetches by URL/method so call order doesn't matter: the page loads
// the grid and (for the profile switcher) the parent's profile list.
function routeFetch(handlers: { get?: Response[]; put?: Response[]; profiles?: Response }) {
  const gets = [...(handlers.get ?? [])];
  const puts = [...(handlers.put ?? [])];
  global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/player-profiles') && (!init?.method || init.method === 'GET')) {
      return handlers.profiles ?? mockResponse(200, PROFILES);
    }
    if (init?.method === 'PUT') {
      return puts.shift() ?? mockResponse(500);
    }
    return gets.shift() ?? mockResponse(500);
  }) as jest.Mock;
}

function availabilityCalls(): [string, RequestInit | undefined][] {
  return (global.fetch as jest.Mock).mock.calls.filter(([url]: [string]) => url.includes('/availability')) as [string, RequestInit | undefined][];
}

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
    pushMock.mockClear();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('loads the grid from GET /player-profiles/:id/availability', async () => {
    routeFetch({
      get: [mockResponse(200, { playerProfileId: 'profile-2', slots: [{ dayOfWeek: 1, startTime: 17 * 60, endTime: 20 * 60, isAvailable: true }] })],
    });

    renderPage();

    await waitFor(() => expect(screen.getByLabelText(/mon start/i)).toHaveValue('17:00'));

    const [url] = availabilityCalls()[0] as [string, RequestInit | undefined];
    expect(url).toContain('/player-profiles/profile-2/availability');
  });

  it('saves edits via PUT /player-profiles/:id/availability and shows a success message', async () => {
    routeFetch({
      get: [mockResponse(200, { playerProfileId: 'profile-2', slots: [{ dayOfWeek: 1, startTime: 17 * 60, endTime: 20 * 60, isAvailable: true }] })],
      put: [mockResponse(200, { playerProfileId: 'profile-2', slots: [{ dayOfWeek: 1, startTime: 18 * 60, endTime: 20 * 60, isAvailable: true }] })],
    });

    renderPage();
    await waitFor(() => expect(screen.getByLabelText(/mon start/i)).toHaveValue('17:00'));

    fireEvent.change(screen.getByLabelText(/mon start/i), { target: { value: '18:00' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Availability saved. Trainers can see these preferences when planning sessions.'));

    const [url, init] = availabilityCalls()[1] as [string, RequestInit];
    expect(url).toContain('/player-profiles/profile-2/availability');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body as string)).toEqual({ slots: [{ dayOfWeek: 1, startTime: 18 * 60, endTime: 20 * 60, isAvailable: true }] });
  });

  it('shows an error state when the availability request fails', async () => {
    routeFetch({ get: [mockResponse(500)] });

    renderPage();

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
  });

  // US-01.09 — profile switcher above the grid.
  describe('profile switcher', () => {
    const GRID = mockResponse(200, { playerProfileId: 'profile-2', slots: [] });

    it("lists the parent's own profile as Me plus each child, with the current profile selected", async () => {
      routeFetch({ get: [GRID] });
      renderPage();

      const select = await screen.findByRole('combobox', { name: /profile/i });
      expect(select).toHaveValue('profile-2');
      expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual(['Me', 'Alex', 'Leo']);
    });

    it("navigates to the chosen profile's availability page", async () => {
      routeFetch({ get: [GRID] });
      renderPage();

      fireEvent.change(await screen.findByRole('combobox', { name: /profile/i }), { target: { value: 'profile-3' } });

      expect(pushMock).toHaveBeenCalledWith('/profiles/profile-3/availability');
    });

    it('is hidden when the parent has a single profile', async () => {
      routeFetch({ get: [GRID], profiles: mockResponse(200, [{ id: 'profile-2', name: 'Alex', isSelf: false }]) });
      renderPage();

      await waitFor(() => expect(screen.getByRole('button', { name: /^save$/i })).toBeInTheDocument());
      expect(screen.queryByRole('combobox', { name: /profile/i })).not.toBeInTheDocument();
    });
  });
});
