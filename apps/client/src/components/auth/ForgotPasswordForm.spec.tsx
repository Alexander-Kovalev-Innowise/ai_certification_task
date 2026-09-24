import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { ForgotPasswordForm } from './ForgotPasswordForm';

function mockResponse(status: number, body: unknown = {}, headers: Record<string, string> = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    headers: new Headers(headers),
  } as unknown as Response;
}

async function fillAndSubmit(email = 'someone@example.com') {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: email } });
  fireEvent.click(screen.getByRole('button', { name: /send reset link/i }));
}

const SUCCESS_MESSAGE = "If that email exists, we've sent a link to reset your password.";

describe('ForgotPasswordForm', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('renders the same success copy for a real email as for an unknown one — no enumeration signal', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(
      mockResponse(202, { message: 'If that email exists, a reset link has been sent.' }),
    );

    render(<ForgotPasswordForm />);
    await fillAndSubmit('real-trainer@example.com');

    expect(await screen.findByText(SUCCESS_MESSAGE)).toBeInTheDocument();
  });

  it('renders the identical success copy even if the response body content differs', async () => {
    // Server always 202s identically per FR-002, but this proves the client
    // itself doesn't try to be "helpful" by reading/branching on whatever
    // the body happens to contain.
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(202, { message: 'unexpected different text' }));

    render(<ForgotPasswordForm />);
    await fillAndSubmit('unknown@example.com');

    expect(await screen.findByText(SUCCESS_MESSAGE)).toBeInTheDocument();
  });

  it('shows a rate-limit notice on 429', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(429, {}, { 'Retry-After': '60' }));

    render(<ForgotPasswordForm />);
    await fillAndSubmit();

    expect(await screen.findByText(/Please try again in 60 seconds/)).toBeInTheDocument();
  });

  it('does not submit an invalid email', async () => {
    render(<ForgotPasswordForm />);
    await fillAndSubmit('not-an-email');

    await waitFor(() => expect(screen.getByText('Enter a valid email address.')).toBeInTheDocument());
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
