import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import type { ApprovalRow } from './ApprovalCard';
import { ApprovalDecisionModal } from './ApprovalDecisionModal';

function mockResponse(status: number, body: unknown = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    headers: new Headers(),
  } as unknown as Response;
}

const APPROVAL: ApprovalRow = {
  id: 'approval-1',
  playerProfileId: 'profile-2',
  playerName: 'Alex',
  eventId: 'event-1',
  amount: '25.00',
  paymentType: 'USD',
  status: 'PENDING',
  requestedAt: '2026-01-01T00:00:00.000Z',
  expiresAt: '2026-01-03T00:00:00.000Z',
};

// fe §9.1 — ApprovalDecisionModal: notes field, `POST
// /approvals/:id/approve|/deny` (api §4.6). A `409 CONFLICT` (expiry sweep
// won the race) re-fetches and re-renders as EXPIRED via `onConflict`,
// rather than a raw conflict error. Task 14.8.
describe('ApprovalDecisionModal', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('renders nothing when isOpen is false or approval/decision is null', () => {
    render(<ApprovalDecisionModal isOpen={false} approval={APPROVAL} decision="approve" onClose={jest.fn()} onResolved={jest.fn()} onConflict={jest.fn()} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('posts POST /approvals/:id/approve with notes and calls onResolved on success', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(200, { ...APPROVAL, status: 'APPROVED', respondedAt: '2026-01-02T00:00:00.000Z' }));
    const onResolved = jest.fn();
    const onClose = jest.fn();

    render(<ApprovalDecisionModal isOpen approval={APPROVAL} decision="approve" onClose={onClose} onResolved={onResolved} onConflict={jest.fn()} />);
    fireEvent.change(screen.getByLabelText(/notes/i), { target: { value: 'Sounds fun!' } });
    fireEvent.click(screen.getByRole('button', { name: /confirm/i }));

    await waitFor(() => expect(onResolved).toHaveBeenCalledWith(expect.objectContaining({ status: 'APPROVED' })));
    expect(onClose).toHaveBeenCalled();

    const [url, init] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/approvals/approval-1/approve');
    expect(JSON.parse(init.body as string)).toEqual({ notes: 'Sounds fun!' });
  });

  it('posts POST /approvals/:id/deny when decision is deny', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(200, { ...APPROVAL, status: 'DENIED' }));

    render(<ApprovalDecisionModal isOpen approval={APPROVAL} decision="deny" onClose={jest.fn()} onResolved={jest.fn()} onConflict={jest.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /confirm/i }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    const [url] = (global.fetch as jest.Mock).mock.calls[0] as [string];
    expect(url).toContain('/approvals/approval-1/deny');
  });

  it('calls onConflict (not a raw error) on a 409 CONFLICT', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(409, { errorCode: 'CONFLICT' }));
    const onConflict = jest.fn();
    const onClose = jest.fn();

    render(<ApprovalDecisionModal isOpen approval={APPROVAL} decision="approve" onClose={onClose} onResolved={jest.fn()} onConflict={onConflict} />);
    fireEvent.click(screen.getByRole('button', { name: /confirm/i }));

    await waitFor(() => expect(onConflict).toHaveBeenCalledWith('approval-1'));
    expect(onClose).toHaveBeenCalled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows a generic error message on a non-409 failure without closing', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(500));
    const onClose = jest.fn();

    render(<ApprovalDecisionModal isOpen approval={APPROVAL} decision="approve" onClose={onClose} onResolved={jest.fn()} onConflict={jest.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /confirm/i }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('calls onClose when Cancel is clicked', () => {
    const onClose = jest.fn();
    render(<ApprovalDecisionModal isOpen approval={APPROVAL} decision="approve" onClose={onClose} onResolved={jest.fn()} onConflict={jest.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onClose).toHaveBeenCalled();
  });
});
