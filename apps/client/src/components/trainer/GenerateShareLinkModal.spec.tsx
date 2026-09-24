import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { GenerateShareLinkModal } from './GenerateShareLinkModal';

function mockResponse(status: number, body: unknown = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    headers: new Headers(),
  } as unknown as Response;
}

// fe §4.4 — GenerateShareLinkModal: type toggle Player-Static/Coach-Unique,
// conditional targetEmail field, posts `POST /share-links` (api §4.4).
// Task 13.3.
describe('GenerateShareLinkModal', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('renders nothing when isOpen is false', () => {
    render(<GenerateShareLinkModal isOpen={false} onClose={jest.fn()} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('defaults to PLAYER_STATIC and submits with no targetEmail', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(
      mockResponse(201, { id: 'link-1', code: 'abc123', type: 'PLAYER_STATIC', joinUrl: '/join/abc123', expiresAt: null, status: 'ACTIVE' }),
    );
    const onGenerated = jest.fn();
    const onClose = jest.fn();

    render(<GenerateShareLinkModal isOpen onClose={onClose} onGenerated={onGenerated} />);
    fireEvent.click(screen.getByRole('button', { name: /generate/i }));

    await waitFor(() => expect(onGenerated).toHaveBeenCalledWith(expect.objectContaining({ code: 'abc123' })));
    expect(onClose).toHaveBeenCalled();

    const [url, init] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/share-links');
    expect(JSON.parse(init.body as string)).toEqual({ type: 'PLAYER_STATIC' });
  });

  it('shows the targetEmail field only for COACH_UNIQUE and requires it before submit', async () => {
    render(<GenerateShareLinkModal isOpen onClose={jest.fn()} />);

    expect(screen.queryByLabelText(/email/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText(/coach/i));
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /generate/i }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('posts type COACH_UNIQUE with targetEmail once provided', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(
      mockResponse(201, { id: 'link-2', code: 'xyz789', type: 'COACH_UNIQUE', joinUrl: '/join/xyz789', expiresAt: '2026-02-01T00:00:00.000Z', status: 'ACTIVE' }),
    );

    render(<GenerateShareLinkModal isOpen onClose={jest.fn()} onGenerated={jest.fn()} />);
    fireEvent.click(screen.getByLabelText(/coach/i));
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'cam@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /generate/i }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    const [, init] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ type: 'COACH_UNIQUE', targetEmail: 'cam@example.com' });
  });

  it('calls onClose when Cancel is clicked', () => {
    const onClose = jest.fn();
    render(<GenerateShareLinkModal isOpen onClose={onClose} />);

    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

    expect(onClose).toHaveBeenCalled();
  });
});
