import { render, screen, waitFor } from '@testing-library/react';

import { VerifyEmailStatus } from './VerifyEmailStatus';

let searchParams = new URLSearchParams('token=abc123');

jest.mock('next/navigation', () => ({
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

describe('VerifyEmailStatus', () => {
  beforeEach(() => {
    searchParams = new URLSearchParams('token=abc123');
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('calls POST /auth/verify-email with the token on mount and shows the verified copy on success', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(200, { emailVerified: true }));

    render(<VerifyEmailStatus />);

    expect(await screen.findByText('Your email has been verified.')).toBeInTheDocument();
    const [url, options] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toContain('/auth/verify-email');
    expect(JSON.parse(options.body)).toEqual({ token: 'abc123' });
  });

  it('shows the invalid/expired copy on a 404', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(404, { errorCode: 'NOT_FOUND' }));

    render(<VerifyEmailStatus />);

    expect(await screen.findByText('This link is invalid or has expired.')).toBeInTheDocument();
  });

  it('shows the invalid/expired copy on a 410', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(410, { errorCode: 'TOKEN_EXPIRED' }));

    render(<VerifyEmailStatus />);

    expect(await screen.findByText('This link is invalid or has expired.')).toBeInTheDocument();
  });

  it('shows the invalid copy immediately, without calling the API, when there is no token', async () => {
    searchParams = new URLSearchParams('');

    render(<VerifyEmailStatus />);

    expect(screen.getByText('This link is invalid or has expired.')).toBeInTheDocument();
    await waitFor(() => expect(global.fetch).not.toHaveBeenCalled());
  });
});
