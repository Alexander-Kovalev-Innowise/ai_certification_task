import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { useAuthStore } from '../../../../src/stores/useAuthStore';
import type { UserSummaryDto } from '../../../../src/types/auth';

import AccountProfilePage from './page';

const replaceMock = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock }),
}));

const testUser: UserSummaryDto = {
  id: 'user-1',
  email: 'alex@example.com',
  role: 'PLAYER_PARENT',
  accountType: 'ADULT',
  firstName: 'Alex',
  lastName: 'Kovalev',
  mustChangePassword: false,
};

function mockResponse(status: number, body: unknown = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    headers: new Headers(),
  } as unknown as Response;
}

function meBody(overrides: Record<string, unknown> = {}) {
  return {
    id: 'user-1',
    email: 'alex@example.com',
    role: 'PLAYER_PARENT',
    accountType: 'ADULT',
    firstName: 'Alex',
    lastName: 'Kovalev',
    phone: null,
    photoUrl: null,
    emailVerified: true,
    mustChangePassword: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <AccountProfilePage />
    </QueryClientProvider>,
  );
}

// fe §3/§4.7/Task 18.1 — `/account/profile`: any authenticated role
// (RoleGuard's "all four roles" branch, same as the unified `/dashboard`),
// `GET/PATCH /me` via useMe, AccountProfileForm + ChangePasswordLink.
describe('AccountProfilePage', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
    useAuthStore.getState().clear();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('redirects away when there is no session', () => {
    renderPage();
    // RoleGuard renders null with no session; no fetch is ever issued.
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('pre-fills AccountProfileForm from GET /me and renders ChangePasswordLink', async () => {
    useAuthStore.getState().setSession({ csrfToken: 'test-csrf-token', accessToken: 'token-abc', user: testUser, expiresAt: Date.now() + 60_000 });
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(200, meBody()));

    renderPage();

    await waitFor(() => expect(screen.getByLabelText(/first name/i)).toHaveValue('Alex'));
    expect(screen.getByRole('link', { name: /change password/i })).toHaveAttribute('href', '/change-password');
  });

  it('saves edits via PATCH /me and shows a success message', async () => {
    useAuthStore.getState().setSession({ csrfToken: 'test-csrf-token', accessToken: 'token-abc', user: testUser, expiresAt: Date.now() + 60_000 });
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(mockResponse(200, meBody()))
      .mockResolvedValueOnce(mockResponse(200, meBody({ firstName: 'Alexander' })));

    renderPage();
    await waitFor(() => expect(screen.getByLabelText(/first name/i)).toHaveValue('Alex'));

    fireEvent.change(screen.getByLabelText(/first name/i), { target: { value: 'Alexander' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/saved/i));

    const [url, init] = (global.fetch as jest.Mock).mock.calls[1] as [string, RequestInit];
    expect(url).toContain('/me');
    expect(init.method).toBe('PATCH');
  });

  it('renders the narrower CHILD field set when GET /me returns accountType CHILD', async () => {
    useAuthStore.getState().setSession({
      accessToken: 'token-abc',
      user: { ...testUser, role: 'PLAYER_PARENT', accountType: 'CHILD' },
      expiresAt: Date.now() + 60_000,
      csrfToken: 'test-csrf-token',
    });
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(200, meBody({ role: 'PLAYER_PARENT', accountType: 'CHILD' })));

    renderPage();

    await waitFor(() => expect(screen.getByLabelText('Photo')).toBeInTheDocument());
    expect(screen.queryByLabelText(/first name/i)).not.toBeInTheDocument();
  });

  it('shows an error state when GET /me fails', async () => {
    useAuthStore.getState().setSession({ csrfToken: 'test-csrf-token', accessToken: 'token-abc', user: testUser, expiresAt: Date.now() + 60_000 });
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(500));

    renderPage();

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
  });

  it('shows the read-only account-created date for every role', async () => {
    useAuthStore.getState().setSession({ csrfToken: 'test-csrf-token', accessToken: 'token-abc', user: testUser, expiresAt: Date.now() + 60_000 });
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(200, meBody({ createdAt: '2026-03-15T12:00:00.000Z' })));

    renderPage();

    await waitFor(() => expect(screen.getByText(/account created/i)).toBeInTheDocument());
    expect(screen.getByText(/account created/i).textContent).toMatch(/2026/);
  });

  it('does not render the Business section for a non-trainer', async () => {
    useAuthStore.getState().setSession({ csrfToken: 'test-csrf-token', accessToken: 'token-abc', user: testUser, expiresAt: Date.now() + 60_000 });
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(200, meBody()));

    renderPage();

    await waitFor(() => expect(screen.getByLabelText(/first name/i)).toBeInTheDocument());
    expect(screen.queryByLabelText(/business name/i)).not.toBeInTheDocument();
  });

  describe('TRAINER Business section', () => {
    const trainerSession = () =>
      useAuthStore.getState().setSession({
        csrfToken: 'test-csrf-token',
        accessToken: 'token-abc',
        user: { ...testUser, role: 'TRAINER' },
        expiresAt: Date.now() + 60_000,
      });

    function routeFetch(handlers: Record<string, (init?: RequestInit) => Response>) {
      (global.fetch as jest.Mock).mockImplementation(async (url: string, init?: RequestInit) => {
        const method = init?.method ?? 'GET';
        const key = Object.keys(handlers).find((k) => `${method} ${new URL(url, 'http://x').pathname}` === k);
        return key && handlers[key] ? handlers[key]!(init) : mockResponse(404);
      });
    }

    const bootstrap = {
      role: 'TRAINER',
      user: { ...testUser, role: 'TRAINER' },
      trainerProfile: { id: 'trainer-1', businessName: 'Acme Co', address: '1 Main St', website: 'https://acme.example.com', description: null },
      branding: { logoUrl: null, primaryColorHex: null },
    };

    it('prefills from bootstrap and saves via PATCH /trainers/:id, sending null for cleared optional fields', async () => {
      trainerSession();
      routeFetch({
        'GET /me': () => mockResponse(200, meBody({ role: 'TRAINER' })),
        'GET /me/bootstrap': () => mockResponse(200, bootstrap),
        'PATCH /trainers/trainer-1': () => mockResponse(200, { id: 'trainer-1', businessName: 'Acme Sports' }),
      });

      renderPage();

      await waitFor(() => expect(screen.getByLabelText(/business name/i)).toHaveValue('Acme Co'));
      expect(screen.getByLabelText(/address/i)).toHaveValue('1 Main St');
      expect(screen.getByLabelText(/website/i)).toHaveValue('https://acme.example.com');

      fireEvent.change(screen.getByLabelText(/business name/i), { target: { value: 'Acme Sports' } });
      fireEvent.change(screen.getByLabelText(/address/i), { target: { value: '' } });
      fireEvent.click(screen.getByRole('button', { name: /save business details/i }));

      await waitFor(() => {
        const call = (global.fetch as jest.Mock).mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === 'PATCH');
        expect(call).toBeDefined();
      });
      const patch = (global.fetch as jest.Mock).mock.calls.find(([url]) => String(url).includes('/trainers/trainer-1')) as [string, RequestInit];
      expect(JSON.parse(patch[1].body as string)).toEqual({
        businessName: 'Acme Sports',
        address: null,
        website: 'https://acme.example.com',
        description: null,
      });
    });

    it('validates the website before calling the API', async () => {
      trainerSession();
      routeFetch({
        'GET /me': () => mockResponse(200, meBody({ role: 'TRAINER' })),
        'GET /me/bootstrap': () => mockResponse(200, bootstrap),
      });

      renderPage();
      await waitFor(() => expect(screen.getByLabelText(/business name/i)).toBeInTheDocument());

      fireEvent.change(screen.getByLabelText(/website/i), { target: { value: 'not a url' } });
      fireEvent.click(screen.getByRole('button', { name: /save business details/i }));

      await waitFor(() => expect(screen.getAllByRole('alert').some((a) => /website/i.test(a.textContent ?? ''))).toBe(true));
      expect((global.fetch as jest.Mock).mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === 'PATCH')).toBe(false);
    });
  });
});
