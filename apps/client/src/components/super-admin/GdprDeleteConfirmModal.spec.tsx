import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { GdprDeleteConfirmModal } from './GdprDeleteConfirmModal';

function mockResponse(status: number, body: unknown = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    headers: new Headers(),
  } as unknown as Response;
}

// fe §4.3/§9.4 — GdprDeleteConfirmModal: DELETE /users/:id (api §3),
// two-step typed-confirmation input, never optimistic. Task 12.5.
describe('GdprDeleteConfirmModal', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('renders nothing when isOpen is false', () => {
    render(<GdprDeleteConfirmModal isOpen={false} userId="u1" onClose={jest.fn()} onDeleted={jest.fn()} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('keeps the confirm button disabled until a reason is given and DELETE is typed', () => {
    render(<GdprDeleteConfirmModal isOpen userId="u1" onClose={jest.fn()} onDeleted={jest.fn()} />);

    const confirmButton = screen.getByRole('button', { name: /permanently delete/i });
    expect(confirmButton).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/reason/i), { target: { value: 'User requested account deletion.' } });
    expect(confirmButton).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/type delete to confirm/i), { target: { value: 'delete' } });
    expect(confirmButton).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/type delete to confirm/i), { target: { value: 'DELETE' } });
    expect(confirmButton).toBeEnabled();
  });

  it('sends DELETE /users/:id with { reason } and calls onDeleted on 204', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(204));
    const onDeleted = jest.fn();

    render(<GdprDeleteConfirmModal isOpen userId="u1" onClose={jest.fn()} onDeleted={onDeleted} />);
    fireEvent.change(screen.getByLabelText(/reason/i), { target: { value: 'User requested account deletion.' } });
    fireEvent.change(screen.getByLabelText(/type delete to confirm/i), { target: { value: 'DELETE' } });
    fireEvent.click(screen.getByRole('button', { name: /permanently delete/i }));

    await waitFor(() => expect(onDeleted).toHaveBeenCalled());
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/users/u1');
    expect(init.method).toBe('DELETE');
    expect(JSON.parse(init.body as string)).toEqual({ reason: 'User requested account deletion.' });
  });

  it('shows an error and does not call onDeleted when the request fails', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(500));
    const onDeleted = jest.fn();

    render(<GdprDeleteConfirmModal isOpen userId="u1" onClose={jest.fn()} onDeleted={onDeleted} />);
    fireEvent.change(screen.getByLabelText(/reason/i), { target: { value: 'User requested account deletion.' } });
    fireEvent.change(screen.getByLabelText(/type delete to confirm/i), { target: { value: 'DELETE' } });
    fireEvent.click(screen.getByRole('button', { name: /permanently delete/i }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(onDeleted).not.toHaveBeenCalled();
  });
});
