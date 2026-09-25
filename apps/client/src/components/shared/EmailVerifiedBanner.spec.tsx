import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { useAuthStore } from '../../stores/useAuthStore';
import type { UserSummaryDto } from '../../types/auth';

import { EmailVerifiedBanner } from './EmailVerifiedBanner';

const testUser: UserSummaryDto = {
  id: 'user-1',
  email: 'unverified@example.com',
  role: 'COACH',
  accountType: 'ADULT',
  firstName: 'Cory',
  lastName: 'Coach',
  mustChangePassword: false,
};

function mockResponse(status: number, body: unknown = {}, headers: Record<string, string> = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    headers: new Headers(headers),
  } as unknown as Response;
}

function meBody(overrides: Record<string, unknown> = {}) {
  return {
    id: 'user-1',
    email: 'unverified@example.com',
    role: 'COACH',
    accountType: 'ADULT',
    firstName: 'Cory',
    lastName: 'Coach',
    phone: null,
    photoUrl: null,
    emailVerified: false,
    mustChangePassword: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function renderBanner() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <EmailVerifiedBanner />
    </QueryClientProvider>,
  );
}

// fe §9.2/Task 18.2 — `EmailVerifiedBanner`: shown whenever `GET /me`'s
// `emailVerified: false`, on every authenticated route (mounted at the root
// boundary, Task 18.2's layout wiring). Non-blocking (architecture §6.5 —
// "no guard checks this value"), dismissible per session, resend button
// disabled with a Retry-After-driven countdown after 429.
describe('EmailVerifiedBanner', () => {
  beforeEach(() => {
    jest.useFakeTimers({ legacyFakeTimers: false });
    global.fetch = jest.fn();
    useAuthStore.getState().clear();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('renders nothing when there is no session', () => {
    renderBanner();
    expect(screen.queryByText(/verify your email/i)).not.toBeInTheDocument();
  });

  it('renders nothing when GET /me reports emailVerified: true', async () => {
    useAuthStore.getState().setSession({ accessToken: 'token-abc', user: testUser, expiresAt: Date.now() + 60_000 });
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(200, meBody({ emailVerified: true })));

    renderBanner();

    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.queryByText(/verify your email/i)).not.toBeInTheDocument();
  });

  it('shows the banner when GET /me reports emailVerified: false', async () => {
    useAuthStore.getState().setSession({ accessToken: 'token-abc', user: testUser, expiresAt: Date.now() + 60_000 });
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(200, meBody()));

    renderBanner();

    await screen.findByText(/verify your email/i);
    expect(screen.getByRole('button', { name: /resend/i })).toBeInTheDocument();
  });

  it('dismisses the banner on click, without blocking navigation (no modal)', async () => {
    useAuthStore.getState().setSession({ accessToken: 'token-abc', user: testUser, expiresAt: Date.now() + 60_000 });
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(200, meBody()));

    renderBanner();
    await screen.findByText(/verify your email/i);

    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));

    expect(screen.queryByText(/verify your email/i)).not.toBeInTheDocument();
  });

  it('disables the resend button with a Retry-After countdown after a 429', async () => {
    useAuthStore.getState().setSession({ accessToken: 'token-abc', user: testUser, expiresAt: Date.now() + 60_000 });
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(mockResponse(200, meBody()))
      .mockResolvedValueOnce(mockResponse(429, {}, { 'Retry-After': '30' }));

    renderBanner();
    await screen.findByText(/verify your email/i);

    fireEvent.click(screen.getByRole('button', { name: /resend/i }));

    await waitFor(() => expect(screen.getByRole('button', { name: /resend/i })).toBeDisabled());
    const initialLabel = screen.getByRole('button', { name: /resend/i }).textContent ?? '';
    const [, initialSecondsText] = /(\d+)s/.exec(initialLabel) ?? [];
    const initialSeconds = Number(initialSecondsText);
    expect(initialSeconds).toBeGreaterThan(0);
    expect(initialSeconds).toBeLessThanOrEqual(31);

    act(() => {
      jest.advanceTimersByTime(5000);
    });

    const laterLabel = screen.getByRole('button', { name: /resend/i }).textContent ?? '';
    const [, laterSecondsText] = /(\d+)s/.exec(laterLabel) ?? [];
    expect(Number(laterSecondsText)).toBeLessThanOrEqual(initialSeconds - 4);

    act(() => {
      jest.advanceTimersByTime(30_000);
    });

    await waitFor(() => expect(screen.getByRole('button', { name: /resend/i })).not.toBeDisabled());
  });
});
