import { fireEvent, render, screen } from '@testing-library/react';

import type { UserDirectoryRow } from './UsersTable';
import { UsersTable } from './UsersTable';

function makeUsers(count: number): UserDirectoryRow[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `user-${index}`,
    email: `user${index}@example.com`,
    role: 'PLAYER_PARENT',
    status: 'ACTIVE',
    firstName: `First${index}`,
    lastName: `Last${index}`,
    createdAt: '2026-01-01T00:00:00.000Z',
    lastLoginAt: null,
  }));
}

// fe §4.3 — UsersTable, virtualized for the 10k-row NFR-002 target
// (Task 12.3). Windowing is driven by the fixed `height`/row-height math
// rather than jsdom-measured layout (jsdom never computes real
// scrollHeight/clientHeight), so these assertions are deterministic.
describe('UsersTable', () => {
  it('shows an empty state when there are no users', () => {
    render(<UsersTable items={[]} hasMore={false} onLoadMore={jest.fn()} />);

    expect(screen.getByText('No users found.')).toBeInTheDocument();
  });

  it('renders only a virtualized window of rows, not all 500, and links each row to /users/:id', () => {
    const users = makeUsers(500);

    render(<UsersTable items={users} hasMore={false} onLoadMore={jest.fn()} height={240} />);

    const rows = screen.getAllByRole('row');
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThan(users.length);
    expect(screen.getByRole('row', { name: /first0 last0/i })).toHaveAttribute('href', '/users/user-0');
  });

  it('calls onLoadMore once scrolled near the bottom while hasMore is true', () => {
    const users = makeUsers(100);
    const onLoadMore = jest.fn();

    render(<UsersTable items={users} hasMore onLoadMore={onLoadMore} height={240} />);
    const viewport = screen.getByTestId('users-table-viewport');

    fireEvent.scroll(viewport, { target: { scrollTop: 10 } });
    expect(onLoadMore).not.toHaveBeenCalled();

    fireEvent.scroll(viewport, { target: { scrollTop: 100 * 48 - 240 } });
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it('does not call onLoadMore near the bottom when hasMore is false', () => {
    const users = makeUsers(100);
    const onLoadMore = jest.fn();

    render(<UsersTable items={users} hasMore={false} onLoadMore={onLoadMore} height={240} />);
    const viewport = screen.getByTestId('users-table-viewport');

    fireEvent.scroll(viewport, { target: { scrollTop: 100 * 48 - 240 } });
    expect(onLoadMore).not.toHaveBeenCalled();
  });

  it('does not call onLoadMore while a page is already being fetched', () => {
    const users = makeUsers(100);
    const onLoadMore = jest.fn();

    render(<UsersTable items={users} hasMore isFetchingNextPage onLoadMore={onLoadMore} height={240} />);
    const viewport = screen.getByTestId('users-table-viewport');

    fireEvent.scroll(viewport, { target: { scrollTop: 100 * 48 - 240 } });
    expect(onLoadMore).not.toHaveBeenCalled();
    expect(screen.getByText('Loading more…')).toBeInTheDocument();
  });
});
