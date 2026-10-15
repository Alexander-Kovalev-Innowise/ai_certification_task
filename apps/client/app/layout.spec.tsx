import { render, screen, waitFor } from '@testing-library/react';

import { useAuthStore } from '../src/stores/useAuthStore';

import RootLayout from './layout';

function mockResponse(status: number, body: unknown = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

describe('RootLayout boot sequence (fe §6.1)', () => {
  beforeEach(() => {
    useAuthStore.getState().clear();
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('renders the loading state first, then the authenticated tree on a 200 refresh', async () => {
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

    render(
      <RootLayout>
        <div>authenticated child</div>
      </RootLayout>,
    );

    // fe §6.1 step 2 — the loading state renders before the refresh call resolves.
    expect(screen.getByRole('status', { name: /loading practiceperfect/i })).toBeInTheDocument();
    expect(screen.queryByText('authenticated child')).not.toBeInTheDocument();

    await waitFor(() => expect(screen.getByText('authenticated child')).toBeInTheDocument());

    expect(screen.queryByRole('status', { name: /loading practiceperfect/i })).not.toBeInTheDocument();
    expect(useAuthStore.getState().accessToken).toBe('token-abc');
  });

  it('renders the loading state first, then the anonymous tree on a 401 refresh', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(401));

    render(
      <RootLayout>
        <div>anonymous child</div>
      </RootLayout>,
    );

    expect(screen.getByRole('status', { name: /loading practiceperfect/i })).toBeInTheDocument();

    await waitFor(() => expect(screen.getByText('anonymous child')).toBeInTheDocument());

    expect(screen.queryByRole('status', { name: /loading practiceperfect/i })).not.toBeInTheDocument();
    expect(useAuthStore.getState().accessToken).toBeNull();
  });
});
