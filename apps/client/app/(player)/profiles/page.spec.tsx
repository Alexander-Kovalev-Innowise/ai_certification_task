import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import { useAuthStore } from '../../../src/stores/useAuthStore';
import type { UserSummaryDto } from '../../../src/types/auth';

import ProfilesPage from './page';

function mockResponse(status: number, body: unknown = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    headers: new Headers(),
  } as unknown as Response;
}

const adultUser: UserSummaryDto = {
  id: 'user-1',
  email: 'priya@example.com',
  role: 'PLAYER_PARENT',
  accountType: 'ADULT',
  firstName: 'Priya',
  lastName: 'Parent',
  mustChangePassword: false,
};

const childUser: UserSummaryDto = { ...adultUser, id: 'user-2', accountType: 'CHILD', firstName: 'Alex' };

function bootstrapBody(user: UserSummaryDto) {
  return {
    role: 'PLAYER_PARENT',
    accountType: user.accountType,
    user,
    contexts: [
      {
        playerProfileId: 'profile-1',
        playerProfileName: 'Priya',
        isSelf: true,
        trainerId: 'trainer-1',
        trainerDisplayName: 'Ace Tennis Academy',
        logoUrl: null,
        primaryColorHex: null,
        connectedAt: '2026-01-01T00:00:00.000Z',
      },
    ],
    activeContext: null,
    pendingApprovalsCount: 0,
  };
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ProfilesPage />
    </QueryClientProvider>,
  );
}

// fe §4.6 — `/profiles`: GET /player-profiles (self + children), +Add Child
// (POST /player-profiles via ChildProfileForm). Task 14.3. Wrapped by
// `(player)/layout.tsx`'s RoleGuard(PLAYER_PARENT), so this leaf doesn't
// re-guard.
describe('ProfilesPage', () => {
  beforeEach(() => {
    useAuthStore.getState().clear();
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('loads bootstrap then GET /player-profiles, and renders the profile grid', async () => {
    useAuthStore.getState().setSession({ accessToken: 't', user: adultUser, expiresAt: Date.now() + 60_000 });
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(mockResponse(200, bootstrapBody(adultUser)))
      .mockResolvedValueOnce(
        mockResponse(200, [
          { id: 'profile-1', name: 'Priya', isSelf: true, trainerCount: 1 },
          { id: 'profile-2', name: 'Alex', isSelf: false, trainerCount: 1 },
        ]),
      );

    renderPage();

    await waitFor(() => expect(screen.getByRole('link', { name: /priya/i })).toBeInTheDocument());
    expect(screen.getByRole('link', { name: /alex/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add child/i })).toBeInTheDocument();
  });

  it('hides "Add Child" for a CHILD session', async () => {
    useAuthStore.getState().setSession({ accessToken: 't', user: childUser, expiresAt: Date.now() + 60_000 });
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(mockResponse(200, bootstrapBody(childUser)))
      .mockResolvedValueOnce(mockResponse(200, [{ id: 'profile-2', name: 'Alex', isSelf: false, trainerCount: 1 }]));

    renderPage();

    await waitFor(() => expect(screen.getByRole('link', { name: /alex/i })).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /add child/i })).not.toBeInTheDocument();
  });

  it('opens ChildProfileForm from "Add Child", refetches profiles on success, and shows a non-blocking warning', async () => {
    useAuthStore.getState().setSession({ accessToken: 't', user: adultUser, expiresAt: Date.now() + 60_000 });
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(mockResponse(200, bootstrapBody(adultUser)))
      .mockResolvedValueOnce(mockResponse(200, [{ id: 'profile-1', name: 'Priya', isSelf: true, trainerCount: 1 }]))
      .mockResolvedValueOnce(
        mockResponse(200, { id: 'profile-2', name: 'Alex', dateOfBirth: '2016-01-01', gender: 'MALE', isSelf: false, warning: 'A similar profile already exists.' }),
      )
      .mockResolvedValueOnce(mockResponse(200, [{ id: 'profile-1', name: 'Priya', isSelf: true, trainerCount: 1 }]));

    renderPage();
    await waitFor(() => expect(screen.getByRole('button', { name: /add child/i })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /add child/i }));
    const dialog = screen.getByRole('dialog');

    fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: 'Alex' } });
    fireEvent.change(screen.getByLabelText(/date of birth/i), { target: { value: '2016-01-01' } });
    fireEvent.change(screen.getByLabelText(/gender/i), { target: { value: 'MALE' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /add child/i }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(await screen.findByText(/similar profile already exists/i)).toBeInTheDocument();
  });

  it('shows an error state when the profiles request fails', async () => {
    useAuthStore.getState().setSession({ accessToken: 't', user: adultUser, expiresAt: Date.now() + 60_000 });
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(200, bootstrapBody(adultUser))).mockResolvedValueOnce(mockResponse(500));

    renderPage();

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
  });
});
