import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { useAuthStore } from '../../stores/useAuthStore';
import { ImpersonationBanner } from '../shared/ImpersonationBanner';

import { ImpersonateConfirmModal, type ImpersonationTarget } from './ImpersonateConfirmModal';

const pushMock = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));

function base64Url(value: object): string {
  return btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function makeToken(payload: object): string {
  return `${base64Url({ alg: 'HS256', typ: 'JWT' })}.${base64Url(payload)}.signature`;
}

function mockResponse(status: number, body: unknown = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    headers: new Headers(),
  } as unknown as Response;
}

const TARGET: ImpersonationTarget = { id: 'trainer-7', firstName: 'Tom', lastName: 'Trainer', role: 'TRAINER' };

// fe §5.1/§16.3 — end-to-end wiring: ImpersonateConfirmModal's confirm ->
// POST /impersonation/start -> useAuthStore.setSession(isImpersonating:
// true) -> ImpersonationBanner appears IMMEDIATELY off that same store
// update (no extra fetch — it's mounted, sitting idle, the whole time, the
// same as BootSequence mounts it at the root) -> banner's own manual "Exit
// Impersonation" runs the identical 3-step sequence (end -> clear ->
// refresh) as the auto-exit-at-0 path (Task 16.1). This is deliberately a
// separate integration spec from ImpersonateConfirmModal.spec.tsx and
// ImpersonationBanner.spec.tsx, which each only ever exercise their own
// half in isolation. Task 16.3.
describe('impersonation start -> banner -> exit end-to-end flow', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
    useAuthStore.getState().clear();
    pushMock.mockClear();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function renderFlow() {
    return render(
      <>
        <ImpersonationBanner />
        <ImpersonateConfirmModal isOpen target={TARGET} onClose={jest.fn()} />
      </>,
    );
  }

  it('shows the banner immediately after start, with no extra fetch beyond POST /impersonation/start, then exits back to the admin session on manual Exit', async () => {
    const impersonationToken = makeToken({
      sub: TARGET.id,
      role: TARGET.role,
      exp: Math.floor((Date.now() + 60 * 60 * 1000) / 1000),
      act: { sub: 'admin-42', role: 'SUPER_ADMIN', imp: 'implog-99' },
    });

    (global.fetch as jest.Mock).mockResolvedValueOnce(
      mockResponse(201, {
        accessToken: impersonationToken,
        expiresIn: 3600,
        impersonationLogId: 'implog-99',
        target: { id: TARGET.id, email: 'tom@example.com', role: 'TRAINER', accountType: 'ADULT', firstName: 'Tom', lastName: 'Trainer', mustChangePassword: false },
      }),
    );

    renderFlow();

    // No banner before impersonation starts.
    expect(screen.queryByTestId('impersonation-banner')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^impersonate$/i }));

    // Banner appears off the SAME store update the modal made — no second
    // fetch beyond the one POST /impersonation/start call.
    await waitFor(() => expect(screen.getByTestId('impersonation-banner')).toBeInTheDocument());
    expect(screen.getByText(/viewing as tom trainer \(trainer\)/i)).toBeInTheDocument();
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(pushMock).toHaveBeenCalledWith('/dashboard');
    expect(useAuthStore.getState().isImpersonating).toBe(true);

    // Manual exit runs the same 3-step sequence as the auto-exit path.
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(mockResponse(204)) // POST /impersonation/end
      .mockResolvedValueOnce(
        mockResponse(200, {
          accessToken: 'admin-token',
          expiresIn: 900,
          user: { id: 'admin-42', email: 'admin@example.com', role: 'SUPER_ADMIN', accountType: 'ADULT', firstName: 'Ada', lastName: 'Admin', mustChangePassword: false },
        }),
      ); // POST /auth/refresh — the admin's own, untouched refresh cookie

    fireEvent.click(screen.getByRole('button', { name: /exit impersonation/i }));

    await waitFor(() => expect(screen.queryByTestId('impersonation-banner')).not.toBeInTheDocument());
    expect(global.fetch).toHaveBeenCalledTimes(3);
    const [endUrl] = (global.fetch as jest.Mock).mock.calls[1] as [string];
    const [refreshUrl] = (global.fetch as jest.Mock).mock.calls[2] as [string];
    expect(endUrl).toContain('/impersonation/end');
    expect(refreshUrl).toContain('/auth/refresh');

    expect(useAuthStore.getState().isImpersonating).toBe(false);
    expect(useAuthStore.getState().accessToken).toBe('admin-token');
    expect(useAuthStore.getState().user?.id).toBe('admin-42');
  });
});
