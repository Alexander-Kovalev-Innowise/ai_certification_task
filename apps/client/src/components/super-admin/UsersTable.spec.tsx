import { fireEvent, render, screen, within } from '@testing-library/react';

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

// fe §4.3 — UsersTable. Rows are paginated client-side by the shared
// DataTable (virtualization was removed), so these assertions are driven by
// props alone — no jsdom layout involved.
describe('UsersTable', () => {
  it('shows an empty state when there are no users', () => {
    render(<UsersTable items={[]} hasMore={false} onLoadMore={jest.fn()} />);

    expect(screen.getByRole('status')).toHaveTextContent('No users found.');
    expect(screen.getByText('No records match your filters. Try adjusting or clearing them.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument();
    // header stays visible
    expect(screen.getAllByRole('columnheader')).toHaveLength(5);
  });

  it('offers "Clear filters" in the empty state only when onClearFilters is passed', () => {
    const onClearFilters = jest.fn();
    render(<UsersTable items={[]} hasMore={false} onLoadMore={jest.fn()} onClearFilters={onClearFilters} />);

    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(onClearFilters).toHaveBeenCalledTimes(1);
  });

  it('renders only the current page of rows, not all 500', () => {
    render(<UsersTable items={makeUsers(500)} hasMore={false} onLoadMore={jest.fn()} />);

    // header + 25 rows on the first page
    expect(screen.getAllByRole('row')).toHaveLength(26);
    expect(screen.getByText('Showing 1–25 of 500')).toBeInTheDocument();
  });

  it('renders a header row with the column names', () => {
    render(<UsersTable items={makeUsers(3)} hasMore={false} onLoadMore={jest.fn()} />);

    const headers = screen.getAllByRole('columnheader').map((header) => header.textContent);
    expect(headers).toEqual(['Name', 'Email', 'Role', 'Status', 'Actions']);
  });

  it('exposes an "Edit user" link to /users/:id on each row, plus a linked name', () => {
    render(<UsersTable items={makeUsers(5)} hasMore={false} onLoadMore={jest.fn()} />);

    const row = screen.getByRole('row', { name: /first0 last0/i });
    expect(within(row).getByRole('link', { name: 'Edit user' })).toHaveAttribute('href', '/users/user-0');
    expect(within(row).getByRole('link', { name: /first0 last0/i })).toHaveAttribute('href', '/users/user-0');
    const lastRow = screen.getByRole('row', { name: /first3 last3/i });
    expect(within(lastRow).getByRole('link', { name: 'Edit user' })).toHaveAttribute('href', '/users/user-3');
  });

  it('keeps a solid table background', () => {
    render(<UsersTable items={makeUsers(2)} hasMore={false} onLoadMore={jest.fn()} />);

    expect(screen.getByRole('table', { name: 'Users' }).closest('.bg-surface-1')).not.toBeNull();
  });

  it('calls onLoadMore from "Next" on the last loaded page while hasMore is true', () => {
    const onLoadMore = jest.fn();
    render(<UsersTable items={makeUsers(25)} hasMore onLoadMore={onLoadMore} />);

    expect(screen.getByText('Showing 1–25 of 25+')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it('does not call onLoadMore from "Next" when hasMore is false', () => {
    const onLoadMore = jest.fn();
    render(<UsersTable items={makeUsers(25)} hasMore={false} onLoadMore={onLoadMore} />);

    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled();
    expect(onLoadMore).not.toHaveBeenCalled();
  });

  it('does not call onLoadMore while a page is already being fetched', () => {
    const onLoadMore = jest.fn();
    render(<UsersTable items={makeUsers(25)} hasMore isFetchingNextPage onLoadMore={onLoadMore} />);

    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled();
    expect(screen.getByText('Loading…')).toBeInTheDocument();
    expect(onLoadMore).not.toHaveBeenCalled();
  });

  it('marks the table busy while refreshing', () => {
    render(<UsersTable items={makeUsers(2)} hasMore={false} onLoadMore={jest.fn()} isRefreshing />);

    expect(screen.getByRole('table', { name: 'Users' })).toHaveAttribute('aria-busy', 'true');
    expect(screen.getAllByRole('row')).toHaveLength(3);
  });
});
