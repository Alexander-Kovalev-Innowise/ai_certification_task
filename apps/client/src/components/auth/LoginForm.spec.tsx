import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { useAuthStore } from '../../stores/useAuthStore';

import { LoginForm } from './LoginForm';

const pushMock = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));

function mockResponse(status: number, body: unknown = {}, headers: Record<string, string> = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    headers: new Headers(headers),
  } as unknown as Response;
}

async function fillAndSubmit(email = 'trainer@example.com', password = 'Password1') {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: email } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: password } });
  fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
}

describe('LoginForm', () => {
  beforeEach(() => {
    useAuthStore.getState().clear();
    pushMock.mockClear();
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('redirects to /change-password before any dashboard route when mustChangePassword is true', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(
      mockResponse(200, {
        accessToken: 'token-abc',
        expiresIn: 900,
        user: {
          id: 'user-1',
          email: 'trainer@example.com',
          role: 'TRAINER',
          accountType: 'ADULT',
          firstName: 'A',
          lastName: 'B',
          mustChangePassword: true,
        },
      }),
    );

    render(<LoginForm />);
    await fillAndSubmit();

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/change-password'));
    expect(pushMock).not.toHaveBeenCalledWith('/dashboard');
  });

  it('redirects straight to /dashboard when mustChangePassword is false', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(
      mockResponse(200, {
        accessToken: 'token-abc',
        expiresIn: 900,
        user: {
          id: 'user-1',
          email: 'trainer@example.com',
          role: 'TRAINER',
          accountType: 'ADULT',
          firstName: 'A',
          lastName: 'B',
          mustChangePassword: false,
        },
      }),
    );

    render(<LoginForm />);
    await fillAndSubmit();

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/dashboard'));
  });

  it('renders the exact FR-013 copy for ACCOUNT_INACTIVE, not the generic invalid-credentials text', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(
      mockResponse(401, { statusCode: 401, errorCode: 'ACCOUNT_INACTIVE', message: 'x', error: 'Unauthorized', path: '/auth/login', requestId: 'r-1' }),
    );

    render(<LoginForm />);
    await fillAndSubmit();

    expect(await screen.findByText('Account deactivated. Contact support.')).toBeInTheDocument();
    expect(screen.queryByText('Invalid email or password.')).not.toBeInTheDocument();
  });

  it('renders the generic invalid-credentials copy for a plain 401', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(
      mockResponse(401, { statusCode: 401, errorCode: 'UNAUTHORIZED', message: 'x', error: 'Unauthorized', path: '/auth/login', requestId: 'r-1' }),
    );

    render(<LoginForm />);
    await fillAndSubmit();

    expect(await screen.findByText('Invalid email or password.')).toBeInTheDocument();
  });

  it('shows a rate-limit notice on 429', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(429, {}, { 'Retry-After': '45' }));

    render(<LoginForm />);
    await fillAndSubmit();

    expect(await screen.findByText(/Please try again in 45 seconds/)).toBeInTheDocument();
  });
});
