import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { InviteCoachModal } from './InviteCoachModal';

function mockResponse(status: number, body: unknown = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    headers: new Headers(),
  } as unknown as Response;
}

// fe §4.4 — InviteCoachModal: posts `POST /coaches/invite`
// `{ email, name?, message? }` (api §4.2). Task 13.2.
describe('InviteCoachModal', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('renders nothing when isOpen is false', () => {
    render(<InviteCoachModal isOpen={false} onClose={jest.fn()} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows a validation error and does not submit when email is empty', async () => {
    render(<InviteCoachModal isOpen onClose={jest.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /send invite/i }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('posts InviteCoachDto and calls onInvited + onClose on success', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(201, { shareLinkCode: 'abc123', expiresAt: '2026-02-01T00:00:00.000Z', status: 'PENDING' }));
    const onInvited = jest.fn();
    const onClose = jest.fn();

    render(<InviteCoachModal isOpen onClose={onClose} onInvited={onInvited} />);
    fireEvent.change(screen.getByLabelText(/^email/i), { target: { value: 'cam@example.com' } });
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'Cam Coach' } });
    fireEvent.click(screen.getByRole('button', { name: /send invite/i }));

    await waitFor(() => expect(onInvited).toHaveBeenCalledWith(expect.objectContaining({ shareLinkCode: 'abc123' })));
    expect(onClose).toHaveBeenCalled();

    const [url, init] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/coaches/invite');
    expect(JSON.parse(init.body as string)).toEqual({ email: 'cam@example.com', name: 'Cam Coach' });
  });

  it.each([
    ['COACH_ALREADY_ASSIGNED', /already assigned to another trainer/i],
    ['COACH_ALREADY_ON_ROSTER', /already on your roster/i],
  ])('maps a 409 %s to a specific message and stays open', async (errorCode, message) => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(409, { errorCode }));
    const onClose = jest.fn();

    render(<InviteCoachModal isOpen onClose={onClose} />);
    fireEvent.change(screen.getByLabelText(/^email/i), { target: { value: 'cam@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /send invite/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('shows a generic error message on failure without closing', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(400, { errorCode: 'VALIDATION_ERROR' }));
    const onClose = jest.fn();

    render(<InviteCoachModal isOpen onClose={onClose} />);
    fireEvent.change(screen.getByLabelText(/^email/i), { target: { value: 'cam@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /send invite/i }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('calls onClose when Cancel is clicked', () => {
    const onClose = jest.fn();
    render(<InviteCoachModal isOpen onClose={onClose} />);

    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

    expect(onClose).toHaveBeenCalled();
  });
});
