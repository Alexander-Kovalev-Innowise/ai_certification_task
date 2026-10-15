import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { DeactivateConfirmModal } from './DeactivateConfirmModal';

function mockResponse(status: number, body: unknown = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    headers: new Headers(),
  } as unknown as Response;
}

// fe §4.3 — DeactivateConfirmModal: POST /users/:id/deactivate|/reactivate
// (api §3), one component for both directions via `action`. Task 12.5.
describe('DeactivateConfirmModal', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('renders nothing when isOpen is false', () => {
    render(<DeactivateConfirmModal isOpen={false} action="deactivate" userId="u1" onClose={jest.fn()} onSuccess={jest.fn()} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('posts POST /users/:id/deactivate and calls onSuccess', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(200, { id: 'u1', status: 'INACTIVE' }));
    const onSuccess = jest.fn();

    render(<DeactivateConfirmModal isOpen action="deactivate" userId="u1" onClose={jest.fn()} onSuccess={onSuccess} />);
    fireEvent.click(screen.getByRole('button', { name: /^deactivate$/i }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith({ id: 'u1', status: 'INACTIVE' }));
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/users/u1/deactivate');
    expect(init.method).toBe('POST');
  });

  it('posts POST /users/:id/reactivate when action="reactivate"', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(200, { id: 'u1', status: 'ACTIVE' }));

    render(<DeactivateConfirmModal isOpen action="reactivate" userId="u1" onClose={jest.fn()} onSuccess={jest.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /^reactivate$/i }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    const [url] = (global.fetch as jest.Mock).mock.calls[0] as [string];
    expect(url).toContain('/users/u1/reactivate');
  });

  it('shows a conflict-specific message on 409 without closing', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(409, { errorCode: 'CONFLICT' }));
    const onClose = jest.fn();

    render(<DeactivateConfirmModal isOpen action="deactivate" userId="u1" onClose={onClose} onSuccess={jest.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /^deactivate$/i }));

    expect(await screen.findByText(/already inactive or deleted/i)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('calls onClose when Cancel is clicked', () => {
    const onClose = jest.fn();
    render(<DeactivateConfirmModal isOpen action="deactivate" userId="u1" onClose={onClose} onSuccess={jest.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

    expect(onClose).toHaveBeenCalled();
  });
});
