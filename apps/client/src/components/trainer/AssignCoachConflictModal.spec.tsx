import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { AssignCoachConflictModal } from './AssignCoachConflictModal';

function mockResponse(status: number, body: unknown = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    headers: new Headers(),
  } as unknown as Response;
}

const COACH = { id: 'coach-1', name: 'Cam Coach' };

// 2026-10-05 is a Monday -> dayOfWeek 1.
function fillSession(overrides: { date?: string; start?: string; end?: string } = {}) {
  fireEvent.change(screen.getByLabelText(/session label/i), { target: { value: 'U12 drill' } });
  fireEvent.change(screen.getByLabelText(/session date/i), { target: { value: overrides.date ?? '2026-10-05' } });
  fireEvent.change(screen.getByLabelText(/start time/i), { target: { value: overrides.start ?? '17:00' } });
  fireEvent.change(screen.getByLabelText(/end time/i), { target: { value: overrides.end ?? '18:30' } });
}

// US-01.10 - AssignCoachConflictModal: GET /coaches/:id/availability/check,
// then (on a conflict) POST /coaches/:id/availability/override with a
// required reason.
describe('AssignCoachConflictModal', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('renders nothing when closed or without a coach', () => {
    const { rerender } = render(<AssignCoachConflictModal isOpen={false} coach={COACH} onClose={jest.fn()} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    rerender(<AssignCoachConflictModal isOpen coach={null} onClose={jest.fn()} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('validates the session form (date + time window) before calling the API', async () => {
    render(<AssignCoachConflictModal isOpen coach={COACH} onClose={jest.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /check availability/i }));
    expect(await screen.findByText(/choose the session date/i)).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();

    fillSession({ start: '18:00', end: '17:00' });
    fireEvent.click(screen.getByRole('button', { name: /check availability/i }));
    expect(await screen.findByText(/end time must be after the start time/i)).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('calls /check with dayOfWeek + minutes and shows a success state when the coach is available', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(200, { hasConflict: false }));

    render(<AssignCoachConflictModal isOpen coach={COACH} onClose={jest.fn()} />);
    fillSession();
    fireEvent.click(screen.getByRole('button', { name: /check availability/i }));

    expect(await screen.findByRole('status')).toHaveTextContent(/cam coach is available at this time/i);
    const [url] = (global.fetch as jest.Mock).mock.calls[0] as [string];
    expect(url).toContain('/coaches/coach-1/availability/check');
    expect(url).toContain('dayOfWeek=1');
    expect(url).toContain('startTime=1020');
    expect(url).toContain('endTime=1110');
    expect(screen.queryByRole('button', { name: /assign anyway/i })).not.toBeInTheDocument();
  });

  it('on a conflict shows the warning, requires a reason, then POSTs the override and closes', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(mockResponse(200, { hasConflict: true }))
      .mockResolvedValueOnce(mockResponse(201, { id: 'ov-1' }));
    const onClose = jest.fn();

    render(<AssignCoachConflictModal isOpen coach={COACH} onClose={onClose} />);
    fillSession();
    fireEvent.click(screen.getByRole('button', { name: /check availability/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Coach Cam Coach is not available at this time per their schedule. Continue anyway?');

    // Reason is REQUIRED.
    fireEvent.click(screen.getByRole('button', { name: /assign anyway/i }));
    expect(await screen.findByText(/please give a reason/i)).toBeInTheDocument();
    expect(global.fetch).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByLabelText(/reason for assigning anyway/i), { target: { value: 'Emergency cover, agreed by phone' } });
    fireEvent.click(screen.getByRole('button', { name: /assign anyway/i }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const [url, init] = (global.fetch as jest.Mock).mock.calls[1] as [string, RequestInit];
    expect(url).toContain('/coaches/coach-1/availability/override');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string) as { eventId: string; reason: string; sessionLabel: string };
    expect(body.reason).toBe('Emergency cover, agreed by phone');
    expect(body.eventId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(body.sessionLabel).toContain('U12 drill');
  });

  it('shows an error and stays open when the check request fails', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(500));
    const onClose = jest.fn();

    render(<AssignCoachConflictModal isOpen coach={COACH} onClose={onClose} />);
    fillSession();
    fireEvent.click(screen.getByRole('button', { name: /check availability/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/something went wrong/i);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('calls onClose from Cancel', () => {
    const onClose = jest.fn();
    render(<AssignCoachConflictModal isOpen coach={COACH} onClose={onClose} />);

    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

    expect(onClose).toHaveBeenCalled();
  });
});
