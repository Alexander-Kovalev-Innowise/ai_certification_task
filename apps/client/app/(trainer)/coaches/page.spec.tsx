import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { useAuthStore } from '../../../src/stores/useAuthStore';
import type { UserSummaryDto } from '../../../src/types/auth';

import CoachesPage from './page';

function mockResponse(status: number, body: unknown = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    headers: new Headers(),
  } as unknown as Response;
}

const trainerUser: UserSummaryDto = {
  id: 'user-1',
  email: 'trainer@example.com',
  role: 'TRAINER',
  accountType: 'ADULT',
  firstName: 'Tia',
  lastName: 'Trainer',
  mustChangePassword: false,
};

function bootstrapBody() {
  return {
    role: 'TRAINER',
    user: trainerUser,
    trainerProfile: { id: 'trainer-1', businessName: 'Ace Tennis' },
    branding: { logoUrl: null, primaryColorHex: null },
    coachCount: 1,
    activePlayerCount: 3,
  };
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <CoachesPage />
    </QueryClientProvider>,
  );
}

// fe §4.4 — `/coaches`: GET /trainers/:id/coaches (own trainerId from
// bootstrap) + invite form (POST /coaches/invite) + PATCH /coaches/:id
// (status) + resend-on-expiry. Task 13.2. Wrapped by
// `(trainer)/layout.tsx`'s RoleGuard(TRAINER), so this leaf doesn't re-guard.
describe('CoachesPage', () => {
  beforeEach(() => {
    useAuthStore.getState().clear();
    useAuthStore.getState().setSession({ csrfToken: 'test-csrf-token', accessToken: 't', user: trainerUser, expiresAt: Date.now() + 60_000 });
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('loads bootstrap for the own trainerId, then GET /trainers/:id/coaches, and renders the roster', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(mockResponse(200, bootstrapBody()))
      .mockResolvedValueOnce(
        mockResponse(200, {
          items: [
            { id: 'coach-1', userId: 'u1', name: 'Cam Coach', email: 'cam@example.com', status: 'ACTIVE', bio: null, joinedAt: '2026-01-01T00:00:00.000Z', invitationStatus: 'Accepted' },
          ],
          nextCursor: null,
          hasMore: false,
        }),
      );

    renderPage();

    await waitFor(() => expect(screen.getByRole('row', { name: /cam coach/i })).toBeInTheDocument());

    const [rosterUrl] = (global.fetch as jest.Mock).mock.calls[1] as [string];
    expect(rosterUrl).toContain('/trainers/trainer-1/coaches');
  });

  it('opens InviteCoachModal from the "Invite Coach" button and refetches the roster on success', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(mockResponse(200, bootstrapBody()))
      .mockResolvedValueOnce(mockResponse(200, { items: [], nextCursor: null, hasMore: false }))
      .mockResolvedValueOnce(mockResponse(201, { shareLinkCode: 'abc123', expiresAt: '2026-02-01T00:00:00.000Z', status: 'PENDING' }))
      .mockResolvedValueOnce(mockResponse(200, { items: [], nextCursor: null, hasMore: false }));

    renderPage();
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));

    fireEvent.click(screen.getByRole('button', { name: /invite coach/i }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/^email/i), { target: { value: 'cam@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /send invite/i }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(4));
  });

  it('shows an error state when the roster request fails', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(200, bootstrapBody())).mockResolvedValueOnce(mockResponse(500));

    renderPage();

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
  });

  it('resends an invite via POST /coaches/invites/:id/resend (not a fresh invite) and refreshes the roster', async () => {
    const invite = { id: 'link-9', userId: null, name: null, email: 'late@example.com', status: 'EXPIRED', joinedAt: null, expiresAt: '2026-01-01T00:00:00.000Z', invitationStatus: 'Expired' };
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(mockResponse(200, bootstrapBody()))
      .mockResolvedValueOnce(mockResponse(200, { items: [invite], nextCursor: null, hasMore: false }))
      .mockResolvedValueOnce(mockResponse(201, { id: 'link-10', shareLinkCode: 'new-code', expiresAt: '2030-01-01T00:00:00.000Z', status: 'PENDING' }))
      .mockResolvedValue(mockResponse(200, { items: [{ ...invite, id: 'link-10', status: 'PENDING', invitationStatus: 'Pending' }], nextCursor: null, hasMore: false }));

    renderPage();
    await waitFor(() => expect(screen.getAllByText('late@example.com').length).toBeGreaterThan(0));

    fireEvent.click(screen.getByRole('button', { name: /resend invite/i }));

    await waitFor(() => expect(screen.getByText('Pending')).toBeInTheDocument());
    const resendCall = (global.fetch as jest.Mock).mock.calls[2] as [string, RequestInit];
    expect(resendCall[0]).toContain('/coaches/invites/link-9/resend');
    expect(resendCall[1].method).toBe('POST');
    expect((global.fetch as jest.Mock).mock.calls.some((call) => (call[0] as string).endsWith('/coaches/invite'))).toBe(false);
  });

  it('removes a coach after confirmation (DELETE /coaches/:id) and refreshes the roster', async () => {
    const coach = { id: 'coach-1', userId: 'u1', name: 'Cam Coach', email: 'cam@example.com', status: 'ACTIVE', bio: null, joinedAt: '2026-01-01T00:00:00.000Z', invitationStatus: 'Accepted' };
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(mockResponse(200, bootstrapBody()))
      .mockResolvedValueOnce(mockResponse(200, { items: [coach], nextCursor: null, hasMore: false }))
      .mockResolvedValueOnce(mockResponse(204))
      .mockResolvedValue(mockResponse(200, { items: [], nextCursor: null, hasMore: false }));

    renderPage();
    await waitFor(() => expect(screen.getByRole('row', { name: /cam coach/i })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Remove Cam Coach' }));
    expect(screen.getByRole('dialog')).toHaveTextContent(/removed from your organisation/i);
    fireEvent.click(screen.getByRole('button', { name: 'Remove coach' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    const deleteCall = (global.fetch as jest.Mock).mock.calls[2] as [string, RequestInit];
    expect(deleteCall[0]).toContain('/coaches/coach-1');
    expect(deleteCall[1].method).toBe('DELETE');
    await waitFor(() => expect(screen.queryByRole('row', { name: /cam coach/i })).not.toBeInTheDocument());
  });

  it('opens the Assign / availability-check modal from the calendar icon action', async () => {
    const coach = { id: 'coach-1', userId: 'u1', name: 'Cam Coach', email: 'cam@example.com', status: 'ACTIVE', bio: null, joinedAt: '2026-01-01T00:00:00.000Z', invitationStatus: 'Accepted' };
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(mockResponse(200, bootstrapBody()))
      .mockResolvedValueOnce(mockResponse(200, { items: [coach], nextCursor: null, hasMore: false }));

    renderPage();
    await waitFor(() => expect(screen.getByRole('row', { name: /cam coach/i })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /check availability \/ assign cam coach to session/i }));

    expect(screen.getByRole('dialog', { name: /assign cam coach to a session/i })).toBeInTheDocument();
  });
});
