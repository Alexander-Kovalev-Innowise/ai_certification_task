import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { RemoveTrainerConfirmModal } from './RemoveTrainerConfirmModal';
import type { TrainerAssociationRow } from './TrainerAssociationList';

function mockResponse(status: number, body: unknown = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    headers: new Headers(),
  } as unknown as Response;
}

const TRAINER: TrainerAssociationRow = {
  trainerId: 'trainer-1',
  businessName: 'Ace Tennis Academy',
  logoUrl: null,
  connectedAt: '2026-01-01T00:00:00.000Z',
  status: 'ACTIVE',
};

// fe §4.6 — RemoveTrainerConfirmModal: "This will cancel all upcoming
// RSVPs" — destructive, never optimistic (unlike RevokeConfirmPopover's
// low-stakes revoke). `DELETE /player-profiles/:id/trainers/:trainerId`
// (api §4.3, FR-032). Task 14.5.
describe('RemoveTrainerConfirmModal', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('renders nothing when isOpen is false or trainer is null', () => {
    render(<RemoveTrainerConfirmModal isOpen={false} profileId="profile-2" trainer={TRAINER} onClose={jest.fn()} onRemoved={jest.fn()} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    render(<RemoveTrainerConfirmModal isOpen profileId="profile-2" trainer={null} onClose={jest.fn()} onRemoved={jest.fn()} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('warns that this will cancel all upcoming RSVPs and names the trainer', () => {
    render(<RemoveTrainerConfirmModal isOpen profileId="profile-2" trainer={TRAINER} onClose={jest.fn()} onRemoved={jest.fn()} />);

    expect(screen.getByText(/cancel all upcoming rsvps/i)).toBeInTheDocument();
    expect(screen.getByText(/ace tennis academy/i)).toBeInTheDocument();
  });

  it('calls DELETE /player-profiles/:id/trainers/:trainerId and onRemoved on confirm — never optimistic', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(204));
    const onRemoved = jest.fn();

    render(<RemoveTrainerConfirmModal isOpen profileId="profile-2" trainer={TRAINER} onClose={jest.fn()} onRemoved={onRemoved} />);

    expect(onRemoved).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /yes, remove/i }));

    await waitFor(() => expect(onRemoved).toHaveBeenCalledWith('trainer-1'));

    const [url, init] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/player-profiles/profile-2/trainers/trainer-1');
    expect(init.method).toBe('DELETE');
  });

  it('shows a generic error message on failure without closing', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(404));
    const onClose = jest.fn();

    render(<RemoveTrainerConfirmModal isOpen profileId="profile-2" trainer={TRAINER} onClose={onClose} onRemoved={jest.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /yes, remove/i }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('calls onClose when Cancel is clicked', () => {
    const onClose = jest.fn();
    render(<RemoveTrainerConfirmModal isOpen profileId="profile-2" trainer={TRAINER} onClose={onClose} onRemoved={jest.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }));
    expect(onClose).toHaveBeenCalled();
  });
});
