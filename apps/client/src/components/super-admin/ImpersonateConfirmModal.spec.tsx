import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { useAuthStore } from '../../stores/useAuthStore';

import { ImpersonateConfirmModal } from './ImpersonateConfirmModal';

const pushMock = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));

function mockResponse(status: number, body: unknown = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    headers: new Headers(),
  } as unknown as Response;
}

const TARGET = { id: 'trainer-7', firstName: 'Tom', lastName: 'Trainer', role: 'TRAINER' as const };

// fe §4.3/§16.3 — ImpersonateConfirmModal: entry point only. Calls
// POST /impersonation/start and populates useAuthStore/isImpersonating (api
// §2). The visible banner/countdown are a later phase — this component just
// starts the session and hands off to /dashboard. Task 12.6.
describe('ImpersonateConfirmModal', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
    useAuthStore.getState().clear();
    pushMock.mockClear();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('renders nothing when isOpen is false', () => {
    render(<ImpersonateConfirmModal isOpen={false} target={TARGET} onClose={jest.fn()} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('posts POST /impersonation/start with targetUserId and populates useAuthStore, then navigates to /dashboard', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(
      mockResponse(201, {
        accessToken: 'impersonation-token',
        expiresIn: 3600,
        impersonationLogId: 'implog-1',
        target: { id: 'trainer-7', email: 'tom@example.com', role: 'TRAINER', accountType: 'ADULT', firstName: 'Tom', lastName: 'Trainer', mustChangePassword: false },
      }),
    );

    render(<ImpersonateConfirmModal isOpen target={TARGET} onClose={jest.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /^impersonate$/i }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/dashboard'));

    const state = useAuthStore.getState();
    expect(state.accessToken).toBe('impersonation-token');
    expect(state.isImpersonating).toBe(true);
    expect(state.user?.id).toBe('trainer-7');

    const [url, init] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/impersonation/start');
    expect(JSON.parse(init.body as string)).toEqual({ targetUserId: 'trainer-7' });
  });

  it('shows a specific message on 422 IMPERSONATION_TARGET_INVALID instead of a generic error', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(422, { errorCode: 'IMPERSONATION_TARGET_INVALID' }));

    render(<ImpersonateConfirmModal isOpen target={TARGET} onClose={jest.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /^impersonate$/i }));

    expect(await screen.findByText(/can't impersonate another super admin/i)).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('shows a specific message on 403 IMPERSONATION_NOT_ALLOWED', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(403, { errorCode: 'IMPERSONATION_NOT_ALLOWED' }));

    render(<ImpersonateConfirmModal isOpen target={TARGET} onClose={jest.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /^impersonate$/i }));

    expect(await screen.findByText(/already impersonating/i)).toBeInTheDocument();
  });

  it('does not render an Impersonate action for a SUPER_ADMIN target', () => {
    render(<ImpersonateConfirmModal isOpen target={{ ...TARGET, role: 'SUPER_ADMIN' }} onClose={jest.fn()} />);

    expect(screen.getByText(/can't impersonate another super admin/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^impersonate$/i })).not.toBeInTheDocument();
  });

  it('calls onClose when Cancel is clicked', () => {
    const onClose = jest.fn();
    render(<ImpersonateConfirmModal isOpen target={TARGET} onClose={onClose} />);

    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

    expect(onClose).toHaveBeenCalled();
  });
});
