import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { ChildLoginForm } from './ChildLoginForm';

function mockResponse(status: number, body: unknown = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    headers: new Headers(),
  } as unknown as Response;
}

describe('ChildLoginForm', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('without a login: posts email + password to /player-profiles/:id/child-login and calls onCreated', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(201, { playerProfileId: 'p1', childUserId: 'c1', email: 'alex@example.com' }));
    const onCreated = jest.fn();

    render(<ChildLoginForm profileId="p1" childName="Alex" hasLogin={false} onCreated={onCreated} />);
    fireEvent.change(screen.getByLabelText(/sign-in email/i), { target: { value: 'alex@example.com' } });
    fireEvent.change(screen.getByLabelText(/initial password/i), { target: { value: 'ChildPass1' } });
    fireEvent.click(screen.getByRole('button', { name: /create login/i }));

    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/player-profiles/p1/child-login');
    expect(JSON.parse(init.body as string)).toEqual({ email: 'alex@example.com', password: 'ChildPass1' });
  });

  it('validates the email and the password policy before submitting', async () => {
    render(<ChildLoginForm profileId="p1" childName="Alex" hasLogin={false} onCreated={jest.fn()} />);
    fireEvent.change(screen.getByLabelText(/sign-in email/i), { target: { value: 'nope' } });
    fireEvent.change(screen.getByLabelText(/initial password/i), { target: { value: 'weak' } });
    fireEvent.click(screen.getByRole('button', { name: /create login/i }));

    await waitFor(() => expect(screen.getAllByRole('alert').length).toBeGreaterThanOrEqual(2));
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('shows a duplicate-email message on 409', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(409, { errorCode: 'CONFLICT' }));
    const onCreated = jest.fn();

    render(<ChildLoginForm profileId="p1" childName="Alex" hasLogin={false} onCreated={onCreated} />);
    fireEvent.change(screen.getByLabelText(/sign-in email/i), { target: { value: 'taken@example.com' } });
    fireEvent.change(screen.getByLabelText(/initial password/i), { target: { value: 'ChildPass1' } });
    fireEvent.click(screen.getByRole('button', { name: /create login/i }));

    expect(await screen.findByText(/already exists/i)).toBeInTheDocument();
    expect(onCreated).not.toHaveBeenCalled();
  });

  it('with a login: offers a password reset (POST .../child-login/reset-password)', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(200, { message: 'Password reset.' }));

    render(<ChildLoginForm profileId="p1" childName="Alex" hasLogin onCreated={jest.fn()} />);
    expect(screen.queryByLabelText(/sign-in email/i)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/new password/i), { target: { value: 'NewChildPass2' } });
    fireEvent.click(screen.getByRole('button', { name: /reset password/i }));

    expect(await screen.findByText(/password updated/i)).toBeInTheDocument();
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/player-profiles/p1/child-login/reset-password');
    expect(JSON.parse(init.body as string)).toEqual({ password: 'NewChildPass2' });
  });
});
