import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import RequestsPage from './page';

const replaceMock = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock, push: jest.fn() }),
}));

function mockResponse(status: number, body: unknown = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    headers: new Headers(),
  } as unknown as Response;
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <RequestsPage />
    </QueryClientProvider>,
  );
}

const ROW = {
  id: 'r1',
  title: 'Skills clinic',
  amount: '25',
  paymentType: 'USD',
  status: 'PENDING',
  requestedAt: '2026-01-01T00:00:00.000Z',
  expiresAt: '2026-01-03T00:00:00.000Z',
};

// `/requests` — CHILD sessions only: own purchase requests + New request modal.
describe('RequestsPage', () => {
  beforeEach(() => {
    replaceMock.mockClear();
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('lists the child\'s own requests with a status badge', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(200, { items: [ROW], nextCursor: null, hasMore: false }));

    renderPage();

    expect(await screen.findByText('Skills clinic')).toBeInTheDocument();
    expect(screen.getByText('Pending Parent Approval')).toBeInTheDocument();
    const [url] = (global.fetch as jest.Mock).mock.calls[0] as [string];
    expect(url).toContain('/me/purchase-requests');
  });

  it('creates a request from the New request modal and refetches the list', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(mockResponse(200, { items: [], nextCursor: null, hasMore: false }))
      .mockResolvedValueOnce(mockResponse(201, { ...ROW }))
      .mockResolvedValueOnce(mockResponse(200, { items: [ROW], nextCursor: null, hasMore: false }));

    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /new request/i }));

    fireEvent.change(screen.getByLabelText(/what is it for/i), { target: { value: 'Skills clinic' } });
    fireEvent.change(screen.getByLabelText(/^amount/i), { target: { value: '25' } });
    fireEvent.click(screen.getByRole('button', { name: /send request/i }));

    expect(await screen.findByText('Skills clinic')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('redirects a non-child (403) to /approvals', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(403, { errorCode: 'FORBIDDEN' }));

    renderPage();

    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/approvals'));
  });

  it('shows an error state when loading fails', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(500));

    renderPage();

    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});
