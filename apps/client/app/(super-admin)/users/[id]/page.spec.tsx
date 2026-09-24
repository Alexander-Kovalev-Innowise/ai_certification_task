import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import UserDetailPage from './page';

jest.mock('next/navigation', () => ({
  useParams: () => ({ id: 'u1' }),
}));

function mockResponse(status: number, body: unknown = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    headers: new Headers(),
  } as unknown as Response;
}

function baseUserBody() {
  return {
    id: 'u1',
    email: 'ada@example.com',
    role: 'TRAINER',
    accountType: 'ADULT',
    firstName: 'Ada',
    lastName: 'Lovelace',
    phone: '+14155552671',
    photoUrl: null,
    emailVerified: true,
    mustChangePassword: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    status: 'ACTIVE',
    lastLoginAt: null,
    deletedAt: null,
  };
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <UserDetailPage />
    </QueryClientProvider>,
  );
}

// fe §4.3 — `/users/[id]` detail: GET/PATCH /users/:id, deactivate/
// reactivate/GDPR-delete actions. Cross-tenant/unauthorized reads return
// 404, never 403 (Layer 3 convention). Task 12.5.
describe('UserDetailPage', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('fetches GET /users/:id and renders the user', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(200, baseUserBody()));

    renderPage();

    await waitFor(() => expect(screen.getByRole('heading', { name: /ada lovelace/i })).toBeInTheDocument());
    const [url] = (global.fetch as jest.Mock).mock.calls[0] as [string];
    expect(url).toContain('/users/u1');
  });

  it('shows a not-found message on a 404 (cross-tenant reads are never a 403)', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(404));

    renderPage();

    expect(await screen.findByText(/could not be found/i)).toBeInTheDocument();
  });

  it('opens DeactivateConfirmModal in "deactivate" mode for an ACTIVE user', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(200, baseUserBody()));

    renderPage();
    await screen.findByRole('heading', { name: /ada lovelace/i });

    fireEvent.click(screen.getByRole('button', { name: /^deactivate user$/i }));

    expect(screen.getByRole('dialog', { name: /deactivate user/i })).toBeInTheDocument();
  });

  it('opens DeactivateConfirmModal in "reactivate" mode for an INACTIVE user', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(200, { ...baseUserBody(), status: 'INACTIVE' }));

    renderPage();
    await screen.findByRole('heading', { name: /ada lovelace/i });

    fireEvent.click(screen.getByRole('button', { name: /^reactivate user$/i }));

    expect(screen.getByRole('dialog', { name: /reactivate user/i })).toBeInTheDocument();
  });

  it('opens GdprDeleteConfirmModal from the Delete button', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(200, baseUserBody()));

    renderPage();
    await screen.findByRole('heading', { name: /ada lovelace/i });

    fireEvent.click(screen.getByRole('button', { name: /delete user \(gdpr\)/i }));

    expect(screen.getByRole('dialog', { name: /delete user \(gdpr\)/i })).toBeInTheDocument();
  });

  it('hides deactivate/delete actions for an already-DELETED user', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(200, { ...baseUserBody(), status: 'DELETED' }));

    renderPage();
    await screen.findByRole('heading', { name: /ada lovelace/i });

    expect(screen.queryByRole('button', { name: /deactivate user/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /delete user \(gdpr\)/i })).not.toBeInTheDocument();
  });
});
