import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { useAuthStore } from '../../stores/useAuthStore';
import type { UserSummaryDto } from '../../types/auth';

import { ChangePasswordForm } from './ChangePasswordForm';

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

function userWith(mustChangePassword: boolean): UserSummaryDto {
  return {
    id: 'user-1',
    email: 'user@example.com',
    role: 'TRAINER',
    accountType: 'ADULT',
    firstName: 'A',
    lastName: 'B',
    mustChangePassword,
  };
}

describe('ChangePasswordForm', () => {
  beforeEach(() => {
    useAuthStore.getState().clear();
    pushMock.mockClear();
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('omits the currentPassword field entirely on the forced path (mustChangePassword: true)', () => {
    useAuthStore.getState().setSession({ accessToken: 't', user: userWith(true), expiresAt: Date.now() + 60_000 });

    render(<ChangePasswordForm />);

    expect(screen.queryByLabelText('Current password')).not.toBeInTheDocument();
    expect(screen.getByLabelText('New password')).toBeInTheDocument();
  });

  it('shows the currentPassword field on the voluntary path (mustChangePassword: false)', () => {
    useAuthStore.getState().setSession({ accessToken: 't', user: userWith(false), expiresAt: Date.now() + 60_000 });

    render(<ChangePasswordForm />);

    expect(screen.getByLabelText('Current password')).toBeInTheDocument();
  });

  it('submits only newPassword on the forced path', async () => {
    useAuthStore.getState().setSession({ accessToken: 't', user: userWith(true), expiresAt: Date.now() + 60_000 });
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(200, { message: 'Password changed.' }));

    render(<ChangePasswordForm />);
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'Password1' } });
    fireEvent.click(screen.getByRole('button', { name: /change password/i }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/login'));
    const [, options] = (global.fetch as jest.Mock).mock.calls[0];
    expect(JSON.parse(options.body)).toEqual({ newPassword: 'Password1' });
  });

  it('clears the session and redirects to /login on success, rather than patching mustChangePassword and going to /dashboard', async () => {
    useAuthStore.getState().setSession({ accessToken: 't', user: userWith(true), expiresAt: Date.now() + 60_000 });
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(200, { message: 'Password changed.' }));

    render(<ChangePasswordForm />);
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'Password1' } });
    fireEvent.click(screen.getByRole('button', { name: /change password/i }));

    await waitFor(() => expect(useAuthStore.getState().accessToken).toBeNull());
    expect(pushMock).toHaveBeenCalledWith('/login');
    expect(pushMock).not.toHaveBeenCalledWith('/dashboard');
  });

  it('shows "Current password is incorrect." on a 401 from the voluntary path', async () => {
    useAuthStore.getState().setSession({ accessToken: 't', user: userWith(false), expiresAt: Date.now() + 60_000 });
    (global.fetch as jest.Mock).mockResolvedValueOnce(
      mockResponse(401, { statusCode: 401, errorCode: 'UNAUTHORIZED', message: 'x', error: 'Unauthorized', path: '/auth/change-password', requestId: 'r-1' }),
    );

    render(<ChangePasswordForm />);
    fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'WrongPass1' } });
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'Password1' } });
    fireEvent.click(screen.getByRole('button', { name: /change password/i }));

    expect(await screen.findByText('Current password is incorrect.')).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });
});
