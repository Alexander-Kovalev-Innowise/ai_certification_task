import { render, screen, waitFor } from '@testing-library/react';

import { useAuthStore } from '../../stores/useAuthStore';
import type { UserSummaryDto } from '../../types/auth';

import { ImpersonationBanner } from './ImpersonationBanner';

function base64Url(value: object): string {
  return btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function makeToken(payload: object): string {
  return `${base64Url({ alg: 'HS256', typ: 'JWT' })}.${base64Url(payload)}.signature`;
}

const TARGET_USER: UserSummaryDto = {
  id: 'trainer-7',
  email: 'tom@example.com',
  role: 'TRAINER',
  accountType: 'ADULT',
  firstName: 'Tom',
  lastName: 'Trainer',
  mustChangePassword: false,
};

function setImpersonatingSession(expiresInMs: number): void {
  const exp = Math.floor((Date.now() + expiresInMs) / 1000);
  const accessToken = makeToken({
    sub: TARGET_USER.id,
    role: TARGET_USER.role,
    exp,
    act: { sub: 'admin-42', role: 'SUPER_ADMIN', imp: 'implog-99' },
  });
  useAuthStore.getState().setSession({ accessToken, user: TARGET_USER, expiresAt: exp * 1000, isImpersonating: true });
}

function mockResponse(status: number, body: unknown = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    headers: new Headers(),
  } as unknown as Response;
}

// fe §5.1/api §2 — ImpersonationBanner: mounted at the root, renders nothing
// when not impersonating. State (whether to render at all) comes from
// decoding the `act` claim off the in-memory access token, never a separate
// fetch. Three-state countdown (>5min normal, <=5min warning, 0 auto-exit),
// plus a manual "Exit Impersonation" control running the identical 3-step
// sequence. Task 16.1.
describe('ImpersonationBanner', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
    useAuthStore.getState().clear();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('renders nothing when there is no session', () => {
    render(<ImpersonationBanner />);
    expect(screen.queryByTestId('impersonation-banner')).not.toBeInTheDocument();
  });

  it('renders nothing for a normal (non-impersonation) session, i.e. a token with no act claim', () => {
    const accessToken = makeToken({ sub: TARGET_USER.id, role: TARGET_USER.role, exp: Math.floor((Date.now() + 60_000) / 1000) });
    useAuthStore.getState().setSession({ accessToken, user: TARGET_USER, expiresAt: Date.now() + 60_000 });

    render(<ImpersonationBanner />);
    expect(screen.queryByTestId('impersonation-banner')).not.toBeInTheDocument();
  });

  it('renders "Viewing as" text and a normal-state countdown when more than 5 minutes remain', () => {
    setImpersonatingSession(10 * 60 * 1000);

    render(<ImpersonationBanner />);

    expect(screen.getByTestId('impersonation-banner')).toBeInTheDocument();
    expect(screen.getByText(/viewing as tom trainer \(trainer\)/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /exit impersonation/i })).toBeInTheDocument();
    expect(screen.queryByText(/session ending soon/i)).not.toBeInTheDocument();
  });

  it('shows the --warning pulse and "Session ending soon" once 5 minutes or less remain', () => {
    setImpersonatingSession(4 * 60 * 1000 + 30_000);

    render(<ImpersonationBanner />);

    expect(screen.getByText(/session ending soon/i)).toBeInTheDocument();
    expect(screen.getByTestId('impersonation-countdown')).toHaveStyle({ color: 'var(--warning)' });
  });

  it('auto-triggers the exit sequence (end -> clear -> refresh) when the countdown reaches 0, even if /impersonation/end 401s', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(mockResponse(401)) // POST /impersonation/end — expired impersonation token, expected per api §2
      .mockResolvedValueOnce(
        mockResponse(200, {
          accessToken: 'admin-token',
          expiresIn: 900,
          user: { id: 'admin-42', email: 'admin@example.com', role: 'SUPER_ADMIN', accountType: 'ADULT', firstName: 'Ada', lastName: 'Admin', mustChangePassword: false },
        }),
      ); // POST /auth/refresh — the admin's own, untouched refresh cookie

    setImpersonatingSession(-1_000); // already expired

    render(<ImpersonationBanner />);

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));

    const [firstUrl] = (global.fetch as jest.Mock).mock.calls[0] as [string];
    const [secondUrl] = (global.fetch as jest.Mock).mock.calls[1] as [string];
    expect(firstUrl).toContain('/impersonation/end');
    expect(secondUrl).toContain('/auth/refresh');

    await waitFor(() => expect(useAuthStore.getState().isImpersonating).toBe(false));
    expect(useAuthStore.getState().accessToken).toBe('admin-token');
    expect(useAuthStore.getState().user?.id).toBe('admin-42');
  });

  it('runs the same 3-step sequence when "Exit Impersonation" is clicked manually', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(mockResponse(204))
      .mockResolvedValueOnce(
        mockResponse(200, {
          accessToken: 'admin-token',
          expiresIn: 900,
          user: { id: 'admin-42', email: 'admin@example.com', role: 'SUPER_ADMIN', accountType: 'ADULT', firstName: 'Ada', lastName: 'Admin', mustChangePassword: false },
        }),
      );

    setImpersonatingSession(10 * 60 * 1000);

    render(<ImpersonationBanner />);
    screen.getByRole('button', { name: /exit impersonation/i }).click();

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));
    const [firstUrl] = (global.fetch as jest.Mock).mock.calls[0] as [string];
    const [secondUrl] = (global.fetch as jest.Mock).mock.calls[1] as [string];
    expect(firstUrl).toContain('/impersonation/end');
    expect(secondUrl).toContain('/auth/refresh');

    await waitFor(() => expect(useAuthStore.getState().isImpersonating).toBe(false));
  });
});
