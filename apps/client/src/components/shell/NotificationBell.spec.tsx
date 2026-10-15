import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { useAuthStore } from '../../stores/useAuthStore';
import type { NotificationsResponse } from '../../types/notifications';

import { NotificationBell } from './NotificationBell';

function mockResponse(status: number, body: unknown = {}): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body, headers: new Headers() } as unknown as Response;
}

const user = { id: 'u1', email: 'a@b.c', role: 'PLAYER_PARENT', accountType: 'ADULT', firstName: 'Ada', lastName: 'Lovelace', mustChangePassword: false } as const;

const FEED: NotificationsResponse = {
  unreadCount: 2,
  items: [
    { id: 'approval:1', kind: 'APPROVAL_PENDING', title: 'Kid One needs your approval', body: 'Cleats - $20', href: '/approvals', createdAt: '2026-10-05T10:00:00.000Z', read: false },
    { id: 'approval:2', kind: 'APPROVAL_PENDING', title: 'Kid Two needs your approval', body: 'Ball - $5', href: '/approvals', createdAt: '2026-10-04T10:00:00.000Z', read: false },
    { id: 'child-decision:3', kind: 'REQUEST_DECIDED', title: 'Request approved', body: 'Jersey', href: '/requests', createdAt: '2026-10-03T10:00:00.000Z', read: true },
  ],
};

function renderBell() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <NotificationBell />
    </QueryClientProvider>,
  );
}

function postedTo(fragment: string): boolean {
  return (global.fetch as jest.Mock).mock.calls.some(
    ([url, init]: [string, RequestInit?]) => url.includes(fragment) && init?.method === 'POST',
  );
}

describe('NotificationBell', () => {
  beforeEach(() => {
    useAuthStore.getState().clear();
    useAuthStore.getState().setSession({ accessToken: 't', expiresAt: Date.now() + 60_000, csrfToken: 'c', user });
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('renders nothing without a session', () => {
    useAuthStore.getState().clear();
    const { container } = renderBell();
    expect(container).toBeEmptyDOMElement();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('shows the unread badge, an accessible name and a live-region announcement', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(mockResponse(200, FEED));
    renderBell();

    expect(await screen.findByRole('button', { name: 'Notifications, 2 unread' })).toBeInTheDocument();
    expect(screen.getByTestId('notification-badge')).toHaveTextContent('2');
    expect(screen.getByRole('status')).toHaveTextContent('2 unread notifications');
    expect((global.fetch as jest.Mock).mock.calls[0][0]).toContain('/me/notifications');
  });

  it('opens a list, marks an item read and closes when it is chosen', async () => {
    (global.fetch as jest.Mock).mockImplementation(async (_url: string, init?: RequestInit) =>
      init?.method === 'POST' ? mockResponse(204) : mockResponse(200, FEED),
    );
    renderBell();

    fireEvent.click(await screen.findByRole('button', { name: 'Notifications, 2 unread' }));
    const link = screen.getByRole('link', { name: /Kid One needs your approval/ });
    expect(link).toHaveAttribute('href', '/approvals');
    expect(screen.getAllByRole('listitem')).toHaveLength(3);

    fireEvent.click(link);

    await waitFor(() => expect(postedTo('/me/notifications/approval%3A1/read')).toBe(true));
    expect(screen.queryByRole('heading', { name: 'Notifications' })).not.toBeInTheDocument();
  });

  it('"Mark all as read" posts read-all', async () => {
    (global.fetch as jest.Mock).mockImplementation(async (_url: string, init?: RequestInit) =>
      init?.method === 'POST' ? mockResponse(204) : mockResponse(200, FEED),
    );
    renderBell();

    fireEvent.click(await screen.findByRole('button', { name: 'Notifications, 2 unread' }));
    fireEvent.click(screen.getByRole('button', { name: 'Mark all as read' }));

    await waitFor(() => expect(postedTo('/me/notifications/read-all')).toBe(true));
  });

  it('shows the empty state, no badge, and closes on Escape returning focus to the bell', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(mockResponse(200, { unreadCount: 0, items: [] }));
    renderBell();

    const bell = await screen.findByRole('button', { name: 'Notifications' });
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(screen.queryByTestId('notification-badge')).not.toBeInTheDocument();

    fireEvent.click(bell);
    expect(screen.getByText("You're all caught up")).toBeInTheDocument();
    expect(bell).toHaveAttribute('aria-expanded', 'true');

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByText("You're all caught up")).not.toBeInTheDocument();
    expect(bell).toHaveAttribute('aria-expanded', 'false');
    expect(bell).toHaveFocus();
  });

  it('caps the badge at 9+', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(mockResponse(200, { unreadCount: 14, items: [] }));
    renderBell();
    expect(await screen.findByTestId('notification-badge')).toHaveTextContent('9+');
  });
});
