import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import UsersPage from './page';

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
      <UsersPage />
    </QueryClientProvider>,
  );
}

// fe §4.3 — `/users` directory page: GET /users via useInfiniteQuery,
// getNextPageParam reading nextCursor/hasMore directly (api §0.9). Task 12.3.
describe('UsersPage', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('fetches GET /users with the default limit and renders the returned rows', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(
      mockResponse(200, {
        items: [
          { id: 'u1', email: 'a@example.com', role: 'TRAINER', status: 'ACTIVE', firstName: 'Ada', lastName: 'Lovelace', createdAt: '2026-01-01T00:00:00.000Z', lastLoginAt: null },
        ],
        nextCursor: null,
        hasMore: false,
      }),
    );

    renderPage();

    await waitFor(() => expect(screen.getByRole('row', { name: /ada lovelace/i })).toBeInTheDocument());

    const [url] = (global.fetch as jest.Mock).mock.calls[0] as [string];
    expect(url).toContain('/users?');
    expect(url).toContain('limit=50');
  });

  it('re-fetches with search/role/status query params when filters change', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(mockResponse(200, { items: [], nextCursor: null, hasMore: false }));

    renderPage();
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByLabelText(/role/i), { target: { value: 'COACH' } });

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));
    const [url] = (global.fetch as jest.Mock).mock.calls[1] as [string];
    expect(url).toContain('role=COACH');
  });

  it('shows an error state when the request fails', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(500));

    renderPage();

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
  });

  it('opens CreateTrainerModal from the "Create Trainer" button and refetches the list on success', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(mockResponse(200, { items: [], nextCursor: null, hasMore: false })) // initial GET /users
      .mockResolvedValueOnce(
        mockResponse(201, { id: 't1', userId: 'u1', businessName: 'Ace Tennis Academy', email: 'ada@example.com', status: 'Active', createdAt: '2026-01-01T00:00:00.000Z' }),
      ) // POST /trainers
      .mockResolvedValueOnce(mockResponse(200, { items: [], nextCursor: null, hasMore: false })); // refetch after invalidation

    renderPage();
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', { name: /create trainer/i }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/business name/i), { target: { value: 'Ace Tennis Academy' } });
    fireEvent.change(screen.getByLabelText(/first name/i), { target: { value: 'Ada' } });
    fireEvent.change(screen.getByLabelText(/last name/i), { target: { value: 'Lovelace' } });
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'ada@example.com' } });
    fireEvent.change(screen.getByLabelText(/phone/i), { target: { value: '+14155552671' } });
    fireEvent.click(screen.getByRole('dialog').querySelector('button[type="submit"]')!);

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(3));
  });
});
