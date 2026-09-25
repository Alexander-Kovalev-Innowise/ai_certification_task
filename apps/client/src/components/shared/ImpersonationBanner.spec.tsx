import { act, render, screen, waitFor } from '@testing-library/react';

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

// Mirrors ImpersonationBanner.tsx's own (unexported) TICK_MS — the `useNow`
// polling interval this test needs to fire exactly once per clock jump.
const TICK_MS = 1_000;

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

  // Task 18.6 — fe §10 flags this countdown's three-state transition as one
  // of this app's four highest-value test targets. Every test above mounts
  // fresh at a single fixed remaining time and asserts the resulting
  // (static) render — none of them prove the countdown actually TRANSITIONS
  // normal -> warning -> auto-exit within one continuously-mounted instance
  // as real time (well, fake time) passes, which is the actual behavior a
  // player/trainer session would experience. This test drives that with
  // fake timers instead of a fresh mount per state.
  it('transitions live through all three countdown states as time advances, within one mounted instance', async () => {
    jest.useFakeTimers({ legacyFakeTimers: false });

    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(mockResponse(401)) // POST /impersonation/end — expired, expected per api §2
      .mockResolvedValueOnce(
        mockResponse(200, {
          accessToken: 'admin-token',
          expiresIn: 900,
          user: { id: 'admin-42', email: 'admin@example.com', role: 'SUPER_ADMIN', accountType: 'ADULT', firstName: 'Ada', lastName: 'Admin', mustChangePassword: false },
        }),
      ); // POST /auth/refresh

    setImpersonatingSession(10 * 60 * 1000); // starts 10 minutes out — normal state

    render(<ImpersonationBanner />);
    // Flushes the entrance-animation rAF (jest's modern fake timers fake
    // requestAnimationFrame too), matching the real-timer behavior every
    // other test in this file already relies on implicitly.
    await act(async () => {
      await jest.advanceTimersByTimeAsync(20);
    });

    // State 1: normal (>5 min remaining).
    expect(screen.getByTestId('impersonation-banner')).toBeInTheDocument();
    expect(screen.queryByText(/session ending soon/i)).not.toBeInTheDocument();

    // Jumps the SYSTEM CLOCK directly (jest.setSystemTime) rather than
    // walking `useNow`'s 1-second interval through every intervening tick
    // (advancing fake timers by the full ~5.5 real minutes would fire ~330
    // separate interval callbacks/re-renders, which is what made an earlier
    // version of this test time out) — then fires exactly ONE tick so
    // `useNow` re-reads the already-jumped `Date.now()`.
    await act(async () => {
      jest.setSystemTime(Date.now() + 5 * 60 * 1000 + 30 * 1000); // now 4:30 remaining
      await jest.advanceTimersByTimeAsync(TICK_MS);
    });

    // State 2: warning (<=5 min remaining).
    expect(await screen.findByText(/session ending soon/i)).toBeInTheDocument();
    expect(screen.getByTestId('impersonation-countdown')).toHaveStyle({ color: 'var(--warning)' });

    // Same clock-jump technique to exhaust the countdown entirely — state 3:
    // auto-exit triggers the same 3-step sequence as a manual exit (already
    // fully asserted end-to-end, with real timers, by the "auto-triggers
    // the exit sequence" test above — this only needs to confirm the
    // trigger actually fires off the LIVE countdown reaching 0, not re-prove
    // the whole async exit chain under fake timers).
    await act(async () => {
      jest.setSystemTime(Date.now() + 5 * 60 * 1000); // now expired
      await jest.advanceTimersByTimeAsync(TICK_MS);
    });

    expect(global.fetch).toHaveBeenCalled();
    const [firstUrl] = (global.fetch as jest.Mock).mock.calls[0] as [string];
    expect(firstUrl).toContain('/impersonation/end');

    jest.useRealTimers();
  });
});
