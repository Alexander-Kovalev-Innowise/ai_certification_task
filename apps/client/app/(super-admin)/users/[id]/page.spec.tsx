import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { useToastStore } from '../../../../src/stores/useToastStore';

import UserDetailPage from './page';

jest.mock('next/navigation', () => ({
  useParams: () => ({ id: 'u1' }),
  useRouter: () => ({ push: jest.fn() }),
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
    expect(screen.getByRole('heading', { level: 1, name: 'Edit user' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to users' })).toHaveAttribute('href', '/users');
    const [url] = (global.fetch as jest.Mock).mock.calls[0] as [string];
    expect(url).toContain('/users/u1');
  });

  describe('Resend setup email', () => {
    beforeEach(() => {
      useToastStore.setState({ toasts: [] });
    });

    it('is offered for a trainer who has not finished setup and POSTs the resend endpoint', async () => {
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce(mockResponse(200, { ...baseUserBody(), mustChangePassword: true }))
        .mockResolvedValueOnce(mockResponse(202, { message: 'Setup invitation sent' }));

      renderPage();
      fireEvent.click(await screen.findByRole('button', { name: 'Resend setup email' }));

      await waitFor(() => {
        const call = (global.fetch as jest.Mock).mock.calls.find(([url]) => String(url).includes('/trainers/by-user/u1/resend-setup'));
        expect(call).toBeDefined();
        expect((call as [string, RequestInit])[1].method).toBe('POST');
      });
      await waitFor(() => expect(useToastStore.getState().toasts.some((toast) => toast.message.includes('ada@example.com'))).toBe(true));
    });

    it('is not shown once the trainer has completed setup, nor for other roles', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(200, baseUserBody()));
      const { unmount } = renderPage();
      await screen.findByRole('heading', { name: /ada lovelace/i });
      expect(screen.queryByRole('button', { name: 'Resend setup email' })).not.toBeInTheDocument();
      unmount();

      (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(200, { ...baseUserBody(), role: 'COACH', mustChangePassword: true }));
      renderPage();
      await screen.findByRole('heading', { name: /ada lovelace/i });
      expect(screen.queryByRole('button', { name: 'Resend setup email' })).not.toBeInTheDocument();
    });
  });

  it('puts Save and the action buttons in the card footer, with Delete styled as danger', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(200, baseUserBody()));

    renderPage();
    await screen.findByRole('heading', { level: 2, name: /ada lovelace/i });

    const save = screen.getByRole('button', { name: /save changes/i });
    const footer = save.closest('[data-slot="card-footer"]');
    expect(footer).not.toBeNull();
    expect(save).toHaveAttribute('type', 'submit');
    expect(save).toHaveClass('btn-primary');

    for (const name of [/^deactivate user$/i, /^impersonate$/i, /delete user \(gdpr\)/i]) {
      const button = screen.getByRole('button', { name });
      expect(footer).toContainElement(button);
      expect(button).toHaveAttribute('type', 'button');
    }
    expect(screen.getByRole('button', { name: /delete user \(gdpr\)/i })).toHaveClass('btn', 'btn-danger');
    expect(screen.getByRole('button', { name: /^deactivate user$/i })).toHaveClass('btn-secondary');
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

  it('opens ImpersonateConfirmModal from the Impersonate button for a non-Super-Admin user', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(200, baseUserBody()));

    renderPage();
    await screen.findByRole('heading', { name: /ada lovelace/i });

    fireEvent.click(screen.getByRole('button', { name: /^impersonate$/i }));

    expect(screen.getByRole('dialog', { name: /impersonate ada lovelace/i })).toBeInTheDocument();
  });

  it('hides the Impersonate button for a SUPER_ADMIN user', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(200, { ...baseUserBody(), role: 'SUPER_ADMIN' }));

    renderPage();
    await screen.findByRole('heading', { name: /ada lovelace/i });

    expect(screen.queryByRole('button', { name: /^impersonate$/i })).not.toBeInTheDocument();
  });
});
