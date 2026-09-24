import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { CreateTrainerModal } from './CreateTrainerModal';

function mockResponse(status: number, body: unknown = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    headers: new Headers(),
  } as unknown as Response;
}

function fillValidForm() {
  fireEvent.change(screen.getByLabelText(/business name/i), { target: { value: 'Ace Tennis Academy' } });
  fireEvent.change(screen.getByLabelText(/first name/i), { target: { value: 'Ada' } });
  fireEvent.change(screen.getByLabelText(/last name/i), { target: { value: 'Lovelace' } });
  fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'ada@example.com' } });
  fireEvent.change(screen.getByLabelText(/phone/i), { target: { value: '+14155552671' } });
}

// fe §4.3/§11.1 — CreateTrainerModal posts `CreateTrainerDto {businessName,
// firstName, lastName, email, phone}` (api §4.1). Task 12.4.
describe('CreateTrainerModal', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('renders nothing when isOpen is false', () => {
    render(<CreateTrainerModal isOpen={false} onClose={jest.fn()} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('posts CreateTrainerDto with the two-name-field shape and calls onCreated + onClose on success', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(
      mockResponse(201, { id: 't1', userId: 'u1', businessName: 'Ace Tennis Academy', email: 'ada@example.com', status: 'Active', createdAt: '2026-01-01T00:00:00.000Z' }),
    );
    const onCreated = jest.fn();
    const onClose = jest.fn();

    render(<CreateTrainerModal isOpen onClose={onClose} onCreated={onCreated} />);
    fillValidForm();
    fireEvent.click(screen.getByRole('button', { name: /create trainer/i }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ id: 't1' })));
    expect(onClose).toHaveBeenCalled();

    const [, init] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({
      businessName: 'Ace Tennis Academy',
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
      phone: '+14155552671',
    });
  });

  it('shows a duplicate-email message on 409 without closing the modal', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(409, { errorCode: 'CONFLICT' }));
    const onClose = jest.fn();

    render(<CreateTrainerModal isOpen onClose={onClose} />);
    fillValidForm();
    fireEvent.click(screen.getByRole('button', { name: /create trainer/i }));

    expect(await screen.findByText(/already exists/i)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('shows validation errors and does not submit when required fields are empty', async () => {
    render(<CreateTrainerModal isOpen onClose={jest.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /create trainer/i }));

    expect(await screen.findAllByRole('alert')).not.toHaveLength(0);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('calls onClose when Cancel is clicked', () => {
    const onClose = jest.fn();
    render(<CreateTrainerModal isOpen onClose={onClose} />);

    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

    expect(onClose).toHaveBeenCalled();
  });
});
