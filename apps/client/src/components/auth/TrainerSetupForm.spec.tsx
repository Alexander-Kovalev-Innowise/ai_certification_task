import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { useAuthStore } from '../../stores/useAuthStore';

import { TrainerSetupForm } from './TrainerSetupForm';

let searchParams = new URLSearchParams('token=setup-tok-1');
const pushMock = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
  useSearchParams: () => searchParams,
}));

function mockResponse(status: number, body: unknown = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    headers: new Headers(),
  } as unknown as Response;
}

async function fillAndSubmit(password = 'Password1') {
  fireEvent.change(screen.getByLabelText('Choose a password'), { target: { value: password } });
  fireEvent.click(screen.getByRole('button', { name: /complete setup/i }));
}

describe('TrainerSetupForm', () => {
  beforeEach(() => {
    searchParams = new URLSearchParams('token=setup-tok-1');
    useAuthStore.getState().clear();
    pushMock.mockClear();
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('shows the invalid/expired copy when there is no token in the URL', () => {
    searchParams = new URLSearchParams('');

    render(<TrainerSetupForm />);

    expect(screen.getByText('This link is invalid or has expired.')).toBeInTheDocument();
  });

  it('shows the invalid/expired copy on 404 and 410', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(404));

    render(<TrainerSetupForm />);
    await fillAndSubmit();

    expect(await screen.findByText('This link is invalid or has expired.')).toBeInTheDocument();
  });

  it('sends setupToken + password and auto-logs-in on success, redirecting to /dashboard', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(
      mockResponse(200, {
        accessToken: 'trainer-token',
        expiresIn: 900,
        user: {
          id: 'trainer-1',
          email: 'new-trainer@example.com',
          role: 'TRAINER',
          accountType: 'ADULT',
          firstName: 'New',
          lastName: 'Trainer',
          mustChangePassword: false,
        },
      }),
    );

    render(<TrainerSetupForm />);
    await fillAndSubmit('Password1');

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/dashboard'));
    expect(useAuthStore.getState().accessToken).toBe('trainer-token');
    const [, options] = (global.fetch as jest.Mock).mock.calls[0];
    expect(JSON.parse(options.body)).toEqual({ setupToken: 'setup-tok-1', password: 'Password1' });
  });

  it('rejects a password that fails PASSWORD_POLICY without calling the API', async () => {
    render(<TrainerSetupForm />);
    await fillAndSubmit('weak');

    expect(await screen.findByText(/at least 8 characters/)).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
