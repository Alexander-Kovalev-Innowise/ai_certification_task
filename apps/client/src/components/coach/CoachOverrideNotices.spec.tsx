import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { useAuthStore } from '../../stores/useAuthStore';

import { CoachOverrideNotices, type CoachOverrideNotice } from './CoachOverrideNotices';

function mockResponse(status: number, body: unknown = {}): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body, headers: new Headers() } as unknown as Response;
}

const base: CoachOverrideNotice = {
  id: 'ov-1',
  eventId: 'ev-1',
  reason: 'Emergency cover',
  sessionLabel: 'Tue drill',
  trainerBusinessName: 'Acme Co',
  createdAt: '2026-10-05T10:00:00.000Z',
  acknowledgedAt: null,
  changeRequestedAt: null,
  changeRequestMessage: null,
};

function renderNotices() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <CoachOverrideNotices coachProfileId="coach-1" />
    </QueryClientProvider>,
  );
}

describe('CoachOverrideNotices', () => {
  beforeEach(() => {
    useAuthStore.getState().clear();
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('renders nothing when there are no overrides', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(mockResponse(200, []));
    const { container } = renderNotices();
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('shows Accept and Request change for a pending notice, and Accept posts the acknowledge', async () => {
    (global.fetch as jest.Mock).mockImplementation(async (_url: string, init?: RequestInit) =>
      init?.method === 'POST' ? mockResponse(204) : mockResponse(200, [base]),
    );
    renderNotices();

    expect(await screen.findByText('Awaiting your response')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Request change' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Accept' }));
    await waitFor(() =>
      expect((global.fetch as jest.Mock).mock.calls.some(([url]: [string]) => url.includes('/overrides/ov-1/acknowledge'))).toBe(true),
    );
  });

  it('Request change opens the form modal', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(mockResponse(200, [base]));
    renderNotices();

    fireEvent.click(await screen.findByRole('button', { name: 'Request change' }));

    expect(screen.getByRole('dialog', { name: 'Request a change' })).toBeInTheDocument();
  });


  it('shows the change-requested and accepted statuses', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(
      mockResponse(200, [
        { ...base, id: 'ov-1', changeRequestedAt: '2026-10-05T11:00:00.000Z', changeRequestMessage: 'Move it please' },
        { ...base, id: 'ov-2', sessionLabel: 'Thu drill', acknowledgedAt: '2026-10-05T12:00:00.000Z' },
      ]),
    );
    renderNotices();

    expect(await screen.findByText('Change requested')).toBeInTheDocument();
    expect(screen.getByText('Accepted')).toBeInTheDocument();
    expect(screen.getByText(/Your request: Move it please/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit request' })).toBeInTheDocument();
    // The accepted notice offers no further actions.
    expect(screen.getAllByRole('button', { name: 'Accept' })).toHaveLength(1);
  });
});
