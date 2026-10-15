import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { NewPurchaseRequestModal } from './NewPurchaseRequestModal';

function mockResponse(status: number, body: unknown = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    headers: new Headers(),
  } as unknown as Response;
}

describe('NewPurchaseRequestModal', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('renders nothing when closed', () => {
    render(<NewPurchaseRequestModal isOpen={false} onClose={jest.fn()} onCreated={jest.fn()} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('posts title, amountCents and paymentType to /me/purchase-requests', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(201, { id: 'r1', status: 'PENDING' }));
    const onCreated = jest.fn();
    const onClose = jest.fn();

    render(<NewPurchaseRequestModal isOpen onClose={onClose} onCreated={onCreated} />);
    fireEvent.change(screen.getByLabelText(/what is it for/i), { target: { value: 'Skills clinic' } });
    fireEvent.change(screen.getByLabelText(/^amount/i), { target: { value: '12.50' } });
    fireEvent.change(screen.getByLabelText(/pay with/i), { target: { value: 'TOKENS' } });
    fireEvent.click(screen.getByRole('button', { name: /send request/i }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ id: 'r1' })));
    expect(onClose).toHaveBeenCalled();
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/me/purchase-requests');
    expect(JSON.parse(init.body as string)).toEqual({ title: 'Skills clinic', amountCents: 1250, currency: 'TOKENS', paymentType: 'TOKENS' });
  });

  it('is marked as the checkout stand-in and validates before submitting', async () => {
    render(<NewPurchaseRequestModal isOpen onClose={jest.fn()} onCreated={jest.fn()} />);

    expect(screen.getByText(/stand-in for event checkout/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /send request/i }));

    await waitFor(() => expect(screen.getAllByRole('alert').length).toBeGreaterThanOrEqual(2));
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('shows a generic error when the request fails', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(500));

    render(<NewPurchaseRequestModal isOpen onClose={jest.fn()} onCreated={jest.fn()} />);
    fireEvent.change(screen.getByLabelText(/what is it for/i), { target: { value: 'Boots' } });
    fireEvent.change(screen.getByLabelText(/^amount/i), { target: { value: '40' } });
    fireEvent.click(screen.getByRole('button', { name: /send request/i }));

    expect(await screen.findByText(/something went wrong/i)).toBeInTheDocument();
  });
});
