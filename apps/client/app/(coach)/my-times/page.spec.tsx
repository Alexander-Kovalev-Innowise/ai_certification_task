import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import MyTimesPage from './page';

function mockResponse(status: number, body: unknown = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    headers: new Headers(),
  } as unknown as Response;
}

function bootstrapBody() {
  return {
    role: 'COACH',
    user: { id: 'coach-user-1', email: 'cory@example.com', role: 'COACH', accountType: 'ADULT', firstName: 'Cory', lastName: 'Coach', mustChangePassword: false },
    coachProfile: { id: 'coach-1', userId: 'coach-user-1', trainerId: 'trainer-1', status: 'ACTIVE', bio: null, credentials: null, certifications: null, publicProfile: false },
    employingTrainer: { id: 'trainer-1', businessName: 'Ace Tennis Academy', logoUrl: null, primaryColorHex: null },
    availabilitySet: true,
  };
}

// URL-routed fetch mock: the page now issues an extra, order-independent
// GET .../availability/overrides (US-01.10) next to the grid requests.
function routeFetch(routes: { method?: string; match: string; response: Response }[]) {
  (global.fetch as jest.Mock).mockImplementation(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const route = routes.find((r) => url.includes(r.match) && (r.method ?? 'GET') === method);
    return route ? route.response : mockResponse(404);
  });
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MyTimesPage />
    </QueryClientProvider>,
  );
}

// fe §4.5 — `/my-times`: `<AvailabilityGrid mode="edit" subject="coach">`
// over `GET/PUT /coaches/:id/availability` (api §4.5, FR-062 "My Times") —
// Task 14.6's shared component, second consumer. The coach's own
// `coachProfileId` comes off `GET /me/bootstrap`'s COACH shape (no `[id]`
// route segment — this is always the caller's own profile), unlike the
// player pair's `useParams()`-sourced id. Wrapped by `(coach)/layout.tsx`'s
// RoleGuard(COACH), so this leaf doesn't re-guard. Task 15.3.
describe('MyTimesPage (coach)', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('loads the grid from GET /coaches/:id/availability using the coachProfileId off bootstrap', async () => {
    routeFetch([
      { match: '/me/bootstrap', response: mockResponse(200, bootstrapBody()) },
      { match: '/coaches/coach-1/availability/overrides', response: mockResponse(200, []) },
      { match: '/coaches/coach-1/availability', response: mockResponse(200, { coachProfileId: 'coach-1', slots: [{ dayOfWeek: 2, startTime: 16 * 60, endTime: 18 * 60, isAvailable: true }] }) },
    ]);

    renderPage();

    await waitFor(() => expect(screen.getByLabelText(/tue start/i)).toHaveValue('16:00'));

    const urls = (global.fetch as jest.Mock).mock.calls.map((call) => call[0] as string);
    expect(urls.some((url) => url.endsWith('/coaches/coach-1/availability'))).toBe(true);
  });

  it('saves edits via PUT /coaches/:id/availability and shows a success message', async () => {
    routeFetch([
      { match: '/me/bootstrap', response: mockResponse(200, bootstrapBody()) },
      { match: '/coaches/coach-1/availability/overrides', response: mockResponse(200, []) },
      { match: '/coaches/coach-1/availability', response: mockResponse(200, { coachProfileId: 'coach-1', slots: [{ dayOfWeek: 2, startTime: 16 * 60, endTime: 18 * 60, isAvailable: true }] }) },
      { method: 'PUT', match: '/coaches/coach-1/availability', response: mockResponse(200, { coachProfileId: 'coach-1', slots: [{ dayOfWeek: 2, startTime: 15 * 60, endTime: 18 * 60, isAvailable: true }] }) },
    ]);

    renderPage();
    await waitFor(() => expect(screen.getByLabelText(/tue start/i)).toHaveValue('16:00'));

    fireEvent.change(screen.getByLabelText(/tue start/i), { target: { value: '15:00' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/saved/i));

    const putCall = (global.fetch as jest.Mock).mock.calls.find((call) => (call[1] as RequestInit | undefined)?.method === 'PUT') as [string, RequestInit];
    const [url, init] = putCall;
    expect(url).toContain('/coaches/coach-1/availability');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body as string)).toEqual({ slots: [{ dayOfWeek: 2, startTime: 15 * 60, endTime: 18 * 60, isAvailable: true }] });
  });

  it('lists trainer overrides and lets the coach acknowledge one (US-01.10)', async () => {
    const notice = {
      id: 'ov-1',
      eventId: 'e-1',
      reason: 'Emergency cover',
      sessionLabel: 'U12 drill',
      trainerBusinessName: 'Ace Tennis Academy',
      createdAt: '2026-10-01T10:00:00.000Z',
      acknowledgedAt: null,
    };
    routeFetch([
      { match: '/me/bootstrap', response: mockResponse(200, bootstrapBody()) },
      { match: '/coaches/coach-1/availability/overrides/ov-1/acknowledge', method: 'POST', response: mockResponse(204) },
      { match: '/coaches/coach-1/availability/overrides', response: mockResponse(200, [notice]) },
      { match: '/coaches/coach-1/availability', response: mockResponse(200, { coachProfileId: 'coach-1', slots: [] }) },
    ]);

    renderPage();

    expect(await screen.findByText('U12 drill')).toBeInTheDocument();
    expect(screen.getByText(/Emergency cover/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Acknowledge' }));

    await waitFor(() =>
      expect(
        (global.fetch as jest.Mock).mock.calls.some(
          (call) => (call[0] as string).endsWith('/overrides/ov-1/acknowledge') && (call[1] as RequestInit).method === 'POST',
        ),
      ).toBe(true),
    );
  });

  it('shows an error state when the availability request fails', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(mockResponse(200, bootstrapBody()))
      .mockResolvedValueOnce(mockResponse(500));

    renderPage();

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
  });
});
