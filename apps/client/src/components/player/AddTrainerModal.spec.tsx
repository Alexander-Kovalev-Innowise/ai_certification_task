import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { AddTrainerModal } from './AddTrainerModal';

function mockResponse(status: number, body: unknown = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    headers: new Headers(),
  } as unknown as Response;
}

const TRAINERS = [{ id: 'trainer-1', businessName: 'Ace Tennis Academy' }];

// fe §4.6 — AddTrainerModal: manual code entry vs. "My Trainers" picker
// (FR-032 option A/B), posts `POST /player-profiles/:id/trainers` (oneOf
// `{shareLinkCode} | {trainerId}`, api §4.3). Task 14.5.
describe('AddTrainerModal', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('renders nothing when isOpen is false', () => {
    render(<AddTrainerModal isOpen={false} profileId="profile-2" availableTrainers={TRAINERS} onClose={jest.fn()} onAdded={jest.fn()} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('defaults to manual code entry and posts { shareLinkCode }', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(
      mockResponse(201, { id: 'assoc-1', trainerId: 'trainer-1', playerProfileId: 'profile-2', status: 'ACTIVE', connectedAt: '2026-01-01T00:00:00.000Z', alreadyConnected: false }),
    );
    const onAdded = jest.fn();
    const onClose = jest.fn();

    render(<AddTrainerModal isOpen profileId="profile-2" availableTrainers={TRAINERS} onClose={onClose} onAdded={onAdded} />);
    fireEvent.change(screen.getByLabelText(/^share link code$/i), { target: { value: 'ABC123' } });
    fireEvent.click(screen.getByRole('button', { name: /^add$/i }));

    await waitFor(() => expect(onAdded).toHaveBeenCalledWith(expect.objectContaining({ trainerId: 'trainer-1' })));
    expect(onClose).toHaveBeenCalled();

    const [url, init] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/player-profiles/profile-2/trainers');
    expect(JSON.parse(init.body as string)).toEqual({ shareLinkCode: 'ABC123' });
  });

  it('switches to the "My Trainers" picker and posts { trainerId }', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(
      mockResponse(200, { id: 'assoc-1', trainerId: 'trainer-1', playerProfileId: 'profile-2', status: 'ACTIVE', connectedAt: '2026-01-01T00:00:00.000Z', alreadyConnected: true }),
    );

    render(<AddTrainerModal isOpen profileId="profile-2" availableTrainers={TRAINERS} onClose={jest.fn()} onAdded={jest.fn()} />);
    fireEvent.click(screen.getByLabelText(/pick from my trainers/i));
    fireEvent.change(screen.getByLabelText(/^trainer$/i), { target: { value: 'trainer-1' } });
    fireEvent.click(screen.getByRole('button', { name: /^add$/i }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    const [, init] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ trainerId: 'trainer-1' });
  });

  it('shows a generic error message on failure without closing', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(404, { errorCode: 'NOT_FOUND' }));
    const onClose = jest.fn();

    render(<AddTrainerModal isOpen profileId="profile-2" availableTrainers={TRAINERS} onClose={onClose} onAdded={jest.fn()} />);
    fireEvent.change(screen.getByLabelText(/^share link code$/i), { target: { value: 'BADCODE' } });
    fireEvent.click(screen.getByRole('button', { name: /^add$/i }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('calls onClose when Cancel is clicked', () => {
    const onClose = jest.fn();
    render(<AddTrainerModal isOpen profileId="profile-2" availableTrainers={TRAINERS} onClose={onClose} onAdded={jest.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onClose).toHaveBeenCalled();
  });
});
