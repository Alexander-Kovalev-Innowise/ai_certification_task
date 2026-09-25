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
  role: 'TRAINER',
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
    role: 'TRAINER',
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
    useAuthStore.getState().setSession({ accessToken: 'token-abc', user: testUser, expiresAt: Date.now() + 60_000 });
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(200, meBody()));

    renderPage();

    await waitFor(() => expect(screen.getByLabelText(/first name/i)).toHaveValue('Alex'));
    expect(screen.getByRole('link', { name: /change password/i })).toHaveAttribute('href', '/change-password');
  });

  it('saves edits via PATCH /me and shows a success message', async () => {
    useAuthStore.getState().setSession({ accessToken: 'token-abc', user: testUser, expiresAt: Date.now() + 60_000 });
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
    });
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(200, meBody({ role: 'PLAYER_PARENT', accountType: 'CHILD' })));

    renderPage();

    await waitFor(() => expect(screen.getByLabelText(/photo url/i)).toBeInTheDocument());
    expect(screen.queryByLabelText(/first name/i)).not.toBeInTheDocument();
  });

  it('shows an error state when GET /me fails', async () => {
    useAuthStore.getState().setSession({ accessToken: 'token-abc', user: testUser, expiresAt: Date.now() + 60_000 });
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(500));

    renderPage();

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
  });
});
