import { fireEvent, render, screen } from '@testing-library/react';

import { ResetPasswordForm } from './ResetPasswordForm';

let searchParams = new URLSearchParams('token=abc123');

jest.mock('next/navigation', () => ({
  useSearchParams: () => searchParams,
}));

function mockResponse(status: number, body: unknown = {}, headers: Record<string, string> = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    headers: new Headers(headers),
  } as unknown as Response;
}

async function fillAndSubmit(password = 'Password1') {
  fireEvent.change(screen.getByLabelText('New password'), { target: { value: password } });
  fireEvent.click(screen.getByRole('button', { name: /reset password/i }));
}

describe('ResetPasswordForm', () => {
  beforeEach(() => {
    searchParams = new URLSearchParams('token=abc123');
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('shows the invalid/expired copy immediately when there is no token in the URL', () => {
    searchParams = new URLSearchParams('');

    render(<ResetPasswordForm />);

    expect(screen.getByText('This link is invalid or has expired.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /request a new link/i })).toHaveAttribute('href', '/forgot-password');
  });

  it('shows the distinct invalid/expired copy on a 404 response', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(404, { errorCode: 'NOT_FOUND' }));

    render(<ResetPasswordForm />);
    await fillAndSubmit();

    expect(await screen.findByText('This link is invalid or has expired.')).toBeInTheDocument();
  });

  it('shows the distinct invalid/expired copy on a 410 response', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(410, { errorCode: 'TOKEN_EXPIRED' }));

    render(<ResetPasswordForm />);
    await fillAndSubmit();

    expect(await screen.findByText('This link is invalid or has expired.')).toBeInTheDocument();
  });

  it('sends the token from the URL alongside the new password, and shows success on 200', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(200, { message: 'Password has been reset.' }));

    render(<ResetPasswordForm />);
    await fillAndSubmit('Password1');

    expect(await screen.findByText('Your password has been reset. You can now sign in.')).toBeInTheDocument();
    const [, options] = (global.fetch as jest.Mock).mock.calls[0];
    expect(JSON.parse(options.body)).toEqual({ token: 'abc123', newPassword: 'Password1' });
  });

  it('does not submit a password that fails PASSWORD_POLICY', async () => {
    render(<ResetPasswordForm />);
    await fillAndSubmit('weak');

    expect(await screen.findByText(/at least 8 characters/)).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
