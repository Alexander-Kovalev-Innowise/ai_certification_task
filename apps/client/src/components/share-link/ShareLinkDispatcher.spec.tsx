import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { useAuthStore } from '../../stores/useAuthStore';
import type { UserSummaryDto } from '../../types/auth';

import { ShareLinkDispatcher } from './ShareLinkDispatcher';

const pushMock = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));

function mockResponse(status: number, body: unknown = {}, headers: Record<string, string> = { 'content-type': 'application/json' }): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    headers: new Headers(headers),
  } as unknown as Response;
}

function validPreview(type: 'PLAYER_STATIC' | 'COACH_UNIQUE' = 'PLAYER_STATIC') {
  return { valid: true, type, trainerDisplayName: 'Coach Lisa', logoUrl: null, primaryColorHex: null };
}

function userWith(overrides: Partial<UserSummaryDto>): UserSummaryDto {
  return {
    id: 'user-1',
    email: 'user@example.com',
    role: 'PLAYER_PARENT',
    accountType: 'ADULT',
    firstName: 'A',
    lastName: 'B',
    mustChangePassword: false,
    ...overrides,
  };
}

describe('ShareLinkDispatcher', () => {
  beforeEach(() => {
    useAuthStore.getState().clear();
    pushMock.mockClear();
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('stage 1 — preview/invalid (Task 11.7)', () => {
    it('fetches GET /share-links/:code on mount', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(200, { valid: false, reason: 'NOT_FOUND' }));

      render(<ShareLinkDispatcher code="abc123" />);

      await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
      const [url] = (global.fetch as jest.Mock).mock.calls[0];
      expect(url).toContain('/share-links/abc123');
    });

    it.each([
      ['NOT_FOUND', "This invitation link doesn't exist."],
      ['EXPIRED', 'This invitation link has expired. Ask your trainer for a new one.'],
      ['EXHAUSTED', 'This invitation link has already been used.'],
      ['REVOKED', 'This invitation link is no longer active.'],
    ] as const)('renders the distinct copy for reason=%s', async (reason, expectedCopy) => {
      (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(200, { valid: false, reason }));

      render(<ShareLinkDispatcher code="abc123" />);

      expect(await screen.findByText(expectedCopy)).toBeInTheDocument();
    });

    it('treats a network-level failure as data (renders the invalid card) instead of throwing', async () => {
      (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('network down'));

      render(<ShareLinkDispatcher code="abc123" />);

      expect(await screen.findByText('Something went wrong loading this invitation link. Please try again.')).toBeInTheDocument();
    });

    it('treats a non-ok HTTP response as data too (never throws)', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(500, {}));

      render(<ShareLinkDispatcher code="abc123" />);

      expect(await screen.findByText('Something went wrong loading this invitation link. Please try again.')).toBeInTheDocument();
    });
  });

  // fe §4.2's branch-selection table (auth-state x link-type), Task 11.10.
  describe('branch selection (auth-state x link-type matrix)', () => {
    it('no session + PLAYER_STATIC -> AnonymousJoinForm (full registration fields)', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(200, validPreview('PLAYER_STATIC')));

      render(<ShareLinkDispatcher code="abc123" />);

      expect(await screen.findByLabelText('Email')).toBeInTheDocument();
    });

    it('no session + COACH_UNIQUE -> AnonymousJoinForm (password-only fields)', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(200, validPreview('COACH_UNIQUE')));

      render(<ShareLinkDispatcher code="abc123" />);

      expect(await screen.findByLabelText('Choose a password')).toBeInTheDocument();
      expect(screen.queryByLabelText('Email')).not.toBeInTheDocument();
    });

    it('PLAYER_PARENT ADULT session -> FamilyPickerForm', async () => {
      useAuthStore.getState().setSession({ accessToken: 't', user: userWith({ role: 'PLAYER_PARENT', accountType: 'ADULT' }), expiresAt: Date.now() + 60_000 });
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce(mockResponse(200, validPreview('PLAYER_STATIC')))
        .mockResolvedValueOnce(mockResponse(200, [{ id: 'p-self', name: 'A', isSelf: true }]));

      render(<ShareLinkDispatcher code="abc123" />);

      expect(await screen.findByText('Who will train with Coach Lisa?')).toBeInTheDocument();
    });

    it('CHILD accountType session -> ChildBlockedNotice, never calls redeem or /player-profiles', async () => {
      useAuthStore.getState().setSession({ accessToken: 't', user: userWith({ role: 'PLAYER_PARENT', accountType: 'CHILD' }), expiresAt: Date.now() + 60_000 });
      (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(200, validPreview('PLAYER_STATIC')));

      render(<ShareLinkDispatcher code="abc123" />);

      expect(await screen.findByText('Ask your parent to register you with this trainer.')).toBeInTheDocument();
      expect(global.fetch).toHaveBeenCalledTimes(1); // only the stage-1 GET — no redeem, no /player-profiles
    });

    it('TRAINER session -> RoleCannotJoinNotice, never calls redeem', async () => {
      useAuthStore.getState().setSession({ accessToken: 't', user: userWith({ role: 'TRAINER' }), expiresAt: Date.now() + 60_000 });
      (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(200, validPreview('PLAYER_STATIC')));

      render(<ShareLinkDispatcher code="abc123" />);

      expect(await screen.findByText(/can't join as a participant/)).toBeInTheDocument();
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('SUPER_ADMIN session -> RoleCannotJoinNotice, never calls redeem', async () => {
      useAuthStore.getState().setSession({ accessToken: 't', user: userWith({ role: 'SUPER_ADMIN' }), expiresAt: Date.now() + 60_000 });
      (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(200, validPreview('PLAYER_STATIC')));

      render(<ShareLinkDispatcher code="abc123" />);

      expect(await screen.findByText(/can't join as a participant/)).toBeInTheDocument();
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('COACH session + COACH_UNIQUE link -> CoachAcceptForm', async () => {
      useAuthStore.getState().setSession({ accessToken: 't', user: userWith({ role: 'COACH' }), expiresAt: Date.now() + 60_000 });
      (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(200, validPreview('COACH_UNIQUE')));

      render(<ShareLinkDispatcher code="abc123" />);

      expect(await screen.findByText('Accept this invitation to coach for Coach Lisa?')).toBeInTheDocument();
    });

    it('COACH session + PLAYER_STATIC link -> unsupported fallback, never calls redeem', async () => {
      useAuthStore.getState().setSession({ accessToken: 't', user: userWith({ role: 'COACH' }), expiresAt: Date.now() + 60_000 });
      (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(200, validPreview('PLAYER_STATIC')));

      render(<ShareLinkDispatcher code="abc123" />);

      expect(await screen.findByText(/can't join as a participant/)).toBeInTheDocument();
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('submit wiring + response routing (Task 11.10)', () => {
    it('ANONYMOUS_REGISTRATION: 201 AuthSessionResponseDto populates useAuthStore and redirects to /dashboard', async () => {
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce(mockResponse(200, validPreview('PLAYER_STATIC')))
        .mockResolvedValueOnce(
          mockResponse(201, {
            accessToken: 'new-token',
            expiresIn: 900,
            user: userWith({ role: 'PLAYER_PARENT', firstName: 'Sam' }),
          }),
        );

      render(<ShareLinkDispatcher code="abc123" />);
      await screen.findByLabelText('Email');

      fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'parent@example.com' } });
      fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'Password1' } });
      fireEvent.change(screen.getByLabelText('Phone number'), { target: { value: '+15551234567' } });
      fireEvent.change(screen.getByLabelText("Player's name"), { target: { value: 'Alex' } });
      fireEvent.change(screen.getByLabelText('Date of birth'), { target: { value: '2015-01-01' } });
      fireEvent.change(screen.getByLabelText('Gender'), { target: { value: 'MALE' } });
      fireEvent.click(screen.getByRole('button', { name: /create account/i }));

      await waitFor(() => expect(useAuthStore.getState().accessToken).toBe('new-token'));
      expect(await screen.findByText('Welcome, Sam!')).toBeInTheDocument();

      const [redeemUrl, redeemOptions] = (global.fetch as jest.Mock).mock.calls[1];
      expect(redeemUrl).toContain('/share-links/abc123/redeem');
      expect(JSON.parse(redeemOptions.body)).toEqual({
        email: 'parent@example.com',
        password: 'Password1',
        phone: '+15551234567',
        playerName: 'Alex',
        dateOfBirth: '2015-01-01',
        gender: 'MALE',
        isSelf: true,
      });

      await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/dashboard'), { timeout: 2000 });
    });

    // Task 18.6 — fe §10 names this component's branch matrix as the
    // highest-value frontend test target; this closes the one real gap
    // found in that matrix. The anonymous COACH_UNIQUE branch (no session +
    // COACH_UNIQUE link) was covered for rendering (branch-selection
    // matrix, above) but never actually submitted end-to-end — its request
    // body shape (`{ password }` only, no email/playerName/etc., per
    // `AnonymousJoinForm.tsx`'s `AnonymousCoachAcceptFields`) and its
    // success routing (an anonymous COACH_ACCEPT also returns an
    // `AuthSessionResponseDto` and auto-logs in, per
    // `ShareLinkDispatcher.tsx`'s own "both auto-login" comment) are both
    // distinct enough from the PLAYER_STATIC path above to warrant their
    // own assertion.
    it('anonymous COACH_ACCEPT: 201 AuthSessionResponseDto populates useAuthStore and redirects, with a password-only redeem body', async () => {
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce(mockResponse(200, validPreview('COACH_UNIQUE')))
        .mockResolvedValueOnce(
          mockResponse(201, {
            accessToken: 'new-coach-token',
            expiresIn: 900,
            user: userWith({ role: 'COACH', firstName: 'Cory' }),
          }),
        );

      render(<ShareLinkDispatcher code="abc123" />);
      await screen.findByLabelText('Choose a password');

      fireEvent.change(screen.getByLabelText('Choose a password'), { target: { value: 'Password1' } });
      fireEvent.click(screen.getByRole('button', { name: /accept invitation/i }));

      await waitFor(() => expect(useAuthStore.getState().accessToken).toBe('new-coach-token'));
      expect(await screen.findByText('Welcome, Cory!')).toBeInTheDocument();

      const [redeemUrl, redeemOptions] = (global.fetch as jest.Mock).mock.calls[1];
      expect(redeemUrl).toContain('/share-links/abc123/redeem');
      expect(JSON.parse(redeemOptions.body)).toEqual({ password: 'Password1' });

      await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/dashboard'), { timeout: 2000 });
    });

    it('ASSOCIATE_EXISTING: 200 array shows a connected message and redirects to /dashboard', async () => {
      useAuthStore.getState().setSession({ accessToken: 't', user: userWith({ role: 'PLAYER_PARENT', accountType: 'ADULT' }), expiresAt: Date.now() + 60_000 });
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce(mockResponse(200, validPreview('PLAYER_STATIC')))
        .mockResolvedValueOnce(mockResponse(200, [{ id: 'p-self', name: 'A', isSelf: true }]))
        .mockResolvedValueOnce(
          mockResponse(200, [{ playerProfileId: 'p-self', status: 'ACTIVE', connectedAt: '2026-01-01', alreadyConnected: false }]),
        );

      render(<ShareLinkDispatcher code="abc123" />);
      await screen.findByText('Who will train with Coach Lisa?');

      fireEvent.click(screen.getByLabelText('Me'));
      fireEvent.click(screen.getByRole('button', { name: /connect/i }));

      expect(await screen.findByText('Connected with Coach Lisa')).toBeInTheDocument();
      const [redeemUrl, redeemOptions] = (global.fetch as jest.Mock).mock.calls[2];
      expect(redeemUrl).toContain('/share-links/abc123/redeem');
      expect(JSON.parse(redeemOptions.body)).toEqual({ subjectProfileIds: ['p-self'] });

      await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/dashboard'), { timeout: 2000 });
    });

    it('COACH_ACCEPT (authenticated): 200 {trainerId,status} shows a connected message and redirects', async () => {
      useAuthStore.getState().setSession({ accessToken: 't', user: userWith({ role: 'COACH' }), expiresAt: Date.now() + 60_000 });
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce(mockResponse(200, validPreview('COACH_UNIQUE')))
        .mockResolvedValueOnce(mockResponse(200, { trainerId: 'trainer-1', status: 'ACTIVE' }));

      render(<ShareLinkDispatcher code="abc123" />);
      await screen.findByText('Accept this invitation to coach for Coach Lisa?');

      fireEvent.click(screen.getByRole('button', { name: /accept invitation/i }));

      expect(await screen.findByText('Connected with Coach Lisa')).toBeInTheDocument();
      await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/dashboard'), { timeout: 2000 });
    });

    it('409 SHARE_LINK_UNAVAILABLE re-fetches stage 1 and re-renders the invalid card with the fresh reason', async () => {
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce(mockResponse(200, validPreview('COACH_UNIQUE'))) // initial GET
        .mockResolvedValueOnce(mockResponse(409, { errorCode: 'SHARE_LINK_UNAVAILABLE', message: 'gone' })) // redeem loses the race
        .mockResolvedValueOnce(mockResponse(200, { valid: false, reason: 'EXHAUSTED' })); // re-fetched GET

      render(<ShareLinkDispatcher code="abc123" />);
      await screen.findByLabelText('Choose a password');

      fireEvent.change(screen.getByLabelText('Choose a password'), { target: { value: 'Password1' } });
      fireEvent.click(screen.getByRole('button', { name: /accept invitation/i }));

      expect(await screen.findByText('This invitation link has already been used.')).toBeInTheDocument();
      expect(global.fetch).toHaveBeenCalledTimes(3);
      expect(pushMock).not.toHaveBeenCalled();
    });

    it('a generic redeem error keeps the form visible with an inline submitError, not a race-retry', async () => {
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce(mockResponse(200, validPreview('COACH_UNIQUE')))
        .mockResolvedValueOnce(mockResponse(400, { errorCode: 'VALIDATION_ERROR', message: 'Weak password' }));

      render(<ShareLinkDispatcher code="abc123" />);
      await screen.findByLabelText('Choose a password');

      fireEvent.change(screen.getByLabelText('Choose a password'), { target: { value: 'Password1' } });
      fireEvent.click(screen.getByRole('button', { name: /accept invitation/i }));

      expect(await screen.findByText('Weak password')).toBeInTheDocument();
      expect(screen.getByLabelText('Choose a password')).toBeInTheDocument();
      expect(pushMock).not.toHaveBeenCalled();
    });
  });
});
