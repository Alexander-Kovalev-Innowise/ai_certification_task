import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { RequestOverrideChangeModal } from './RequestOverrideChangeModal';

function mockResponse(status: number, body: unknown = {}): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body, headers: new Headers() } as unknown as Response;
}

function renderModal(props: Partial<React.ComponentProps<typeof RequestOverrideChangeModal>> = {}) {
  const onClose = jest.fn();
  const onSent = jest.fn();
  render(
    <RequestOverrideChangeModal coachProfileId="coach-1" overrideId="ov-1" sessionLabel="Tue drill" onClose={onClose} onSent={onSent} {...props} />,
  );
  return { onClose, onSent };
}

describe('RequestOverrideChangeModal', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('is a labelled dialog that names the session', () => {
    renderModal();
    expect(screen.getByRole('dialog', { name: 'Request a change' })).toBeInTheDocument();
    expect(screen.getByText(/Tue drill/)).toBeInTheDocument();
  });

  it('validates the message (5-500 chars) and does not submit an invalid one', async () => {
    renderModal();

    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'abc' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/at least 5 characters/i);

    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'x'.repeat(501) } });
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/500 characters or fewer/i));
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('posts the message to the request-change endpoint and calls onSent', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(204));
    const { onSent } = renderModal();

    fireEvent.change(screen.getByLabelText('Message'), { target: { value: '  Could this move to Wednesday?  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }));

    await waitFor(() => expect(onSent).toHaveBeenCalled());
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/coaches/coach-1/availability/overrides/ov-1/request-change');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ message: 'Could this move to Wednesday?' });
  });

  it('shows a server error and stays open', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(409, { errorCode: 'OVERRIDE_ALREADY_ACKNOWLEDGED' }));
    const { onSent, onClose } = renderModal();

    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Please change it' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/already accepted/i);
    expect(onSent).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('Cancel and Escape close it', () => {
    const { onClose } = renderModal();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
