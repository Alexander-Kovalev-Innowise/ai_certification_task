import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import ApprovalsPage from './page';

const replaceMock = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock }),
}));

function mockResponse(status: number, body: unknown = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    headers: new Headers(),
  } as unknown as Response;
}

function approval(overrides: Record<string, unknown> = {}) {
  return {
    id: 'approval-1',
    playerProfileId: 'profile-2',
    playerName: 'Alex',
    eventId: 'event-1',
    amount: '25.00',
    paymentType: 'USD',
    status: 'PENDING',
    requestedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 10 * 60 * 60 * 1000).toISOString(),
    ...overrides,
  };
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ApprovalsPage />
    </QueryClientProvider>,
  );
}

// fe §4.6/§9.1 — `/approvals`: GET /approvals, approve/deny actions via
// ApprovalDecisionModal (adult parent only — a CHILD session hitting this
// route directly gets the 403 CHILD_CAPABILITY_DENIED fallback redirect).
// Task 14.8. Wrapped by `(player)/layout.tsx`'s RoleGuard(PLAYER_PARENT).
describe('ApprovalsPage', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
    replaceMock.mockClear();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('loads GET /approvals and renders the pending list', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(200, { items: [approval()], nextCursor: null, hasMore: false }));

    renderPage();

    await waitFor(() => expect(screen.getByRole('article', { name: 'Alex' })).toBeInTheDocument());
    const [url] = (global.fetch as jest.Mock).mock.calls[0] as [string];
    expect(url).toContain('/approvals');
  });

  it('opens ApprovalDecisionModal on Approve, and updates the list on success', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(mockResponse(200, { items: [approval()], nextCursor: null, hasMore: false }))
      .mockResolvedValueOnce(mockResponse(200, approval({ status: 'APPROVED', respondedAt: new Date().toISOString() })));

    renderPage();
    await waitFor(() => expect(screen.getByRole('article', { name: 'Alex' })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /^approve$/i }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /confirm approval/i }));

    await waitFor(() => expect(screen.getByText('APPROVED')).toBeInTheDocument());
  });

  it('shows a toast and refetches on a 409 conflict from the decision modal', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(mockResponse(200, { items: [approval()], nextCursor: null, hasMore: false }))
      .mockResolvedValueOnce(mockResponse(409, { errorCode: 'CONFLICT' }))
      .mockResolvedValueOnce(mockResponse(200, { items: [approval({ status: 'EXPIRED' })], nextCursor: null, hasMore: false }));

    renderPage();
    await waitFor(() => expect(screen.getByRole('button', { name: /^deny$/i })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /^deny$/i }));
    fireEvent.click(screen.getByRole('button', { name: /confirm denial/i }));

    expect(await screen.findByText(/expired before your response was received/i)).toBeInTheDocument();
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(3));
  });

  it('redirects to /dashboard on a 403 CHILD_CAPABILITY_DENIED fallback', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(403, { errorCode: 'CHILD_CAPABILITY_DENIED' }));

    renderPage();

    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/dashboard'));
  });

  it('shows a generic error state on an unrelated failure', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce(mockResponse(500));

    renderPage();

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(replaceMock).not.toHaveBeenCalled();
  });
});
