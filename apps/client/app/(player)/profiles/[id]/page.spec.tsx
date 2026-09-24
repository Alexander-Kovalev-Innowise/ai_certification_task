import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { useAuthStore } from '../../../../src/stores/useAuthStore';
import type { UserSummaryDto } from '../../../../src/types/auth';

import ProfileDetailPage from './page';

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

function profileBody() {
  return {
    id: 'profile-2',
    name: 'Alex',
    school: null,
    jerseyNumber: null,
    photoUrl: null,
    emergencyContact: null,
    allowChildTokenSpendWithoutApproval: false,
    isSelf: false,
  };
}

function trainersBody() {
  return [{ trainerId: 'trainer-1', businessName: 'Ace Tennis Academy', logoUrl: null, connectedAt: '2026-01-01T00:00:00.000Z', status: 'ACTIVE' }];
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ProfileDetailPage />
    </QueryClientProvider>,
  );
}

// fe §4.6 — `/profiles/[id]`: GET/PATCH /player-profiles/:id
// (ProfileEditForm) + GET /player-profiles/:id/trainers
// (TrainerAssociationList). Task 14.4. Wrapped by `(player)/layout.tsx`'s
// RoleGuard(PLAYER_PARENT), so this leaf doesn't re-guard.
describe('ProfileDetailPage', () => {
  beforeEach(() => {
    useAuthStore.getState().clear();
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('loads the profile and trainer list, and renders the edit form + trainer list', async () => {
    useAuthStore.getState().setSession({ accessToken: 't', user: adultUser, expiresAt: Date.now() + 60_000 });
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(200, profileBody())).mockResolvedValueOnce(mockResponse(200, trainersBody()));

    renderPage();

    await waitFor(() => expect(screen.getByLabelText(/^name/i)).toHaveValue('Alex'));
    expect(screen.getByText('Ace Tennis Academy')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add trainer/i })).toBeInTheDocument();

    const [profileUrl] = (global.fetch as jest.Mock).mock.calls[0] as [string];
    const [trainersUrl] = (global.fetch as jest.Mock).mock.calls[1] as [string];
    expect(profileUrl).toContain('/player-profiles/profile-2');
    expect(trainersUrl).toContain('/player-profiles/profile-2/trainers');
  });

  it('hides guardian-only fields and Add Trainer/Remove for a CHILD session', async () => {
    useAuthStore.getState().setSession({ accessToken: 't', user: childUser, expiresAt: Date.now() + 60_000 });
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(200, profileBody())).mockResolvedValueOnce(mockResponse(200, trainersBody()));

    renderPage();

    await waitFor(() => expect(screen.getByLabelText(/^name/i)).toBeInTheDocument());
    expect(screen.queryByLabelText(/spend.*without approval/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /add trainer/i })).not.toBeInTheDocument();
  });

  it('saves edits and updates the cached profile on success', async () => {
    useAuthStore.getState().setSession({ accessToken: 't', user: adultUser, expiresAt: Date.now() + 60_000 });
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(mockResponse(200, profileBody()))
      .mockResolvedValueOnce(mockResponse(200, trainersBody()))
      .mockResolvedValueOnce(mockResponse(200, { ...profileBody(), name: 'Alexander' }));

    renderPage();
    await waitFor(() => expect(screen.getByLabelText(/^name/i)).toHaveValue('Alex'));

    fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: 'Alexander' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Alexander' })).toBeInTheDocument());
  });

  it('shows an error state when the profile request fails', async () => {
    useAuthStore.getState().setSession({ accessToken: 't', user: adultUser, expiresAt: Date.now() + 60_000 });
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(500)).mockResolvedValueOnce(mockResponse(200, trainersBody()));

    renderPage();

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
  });
});
