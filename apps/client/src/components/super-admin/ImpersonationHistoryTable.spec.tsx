import { fireEvent, render, screen } from '@testing-library/react';

import type { ImpersonationHistoryRow } from './ImpersonationHistoryTable';
import { ImpersonationHistoryTable } from './ImpersonationHistoryTable';

function summary(overrides: Partial<ImpersonationHistoryRow['admin']> = {}) {
  return {
    id: 'admin-42',
    email: 'ada@example.com',
    role: 'SUPER_ADMIN' as const,
    accountType: 'ADULT' as const,
    firstName: 'Ada',
    lastName: 'Admin',
    mustChangePassword: false,
    ...overrides,
  };
}

function row(overrides: Partial<ImpersonationHistoryRow> = {}): ImpersonationHistoryRow {
  return {
    id: 'implog-1',
    admin: summary(),
    target: summary({ id: 'trainer-7', role: 'TRAINER', firstName: 'Tom', lastName: 'Trainer' }),
    startedAt: '2026-01-05T12:00:00.000Z',
    endedAt: '2026-01-05T12:20:00.000Z',
    durationSeconds: 1200,
    ...overrides,
  };
}

// fe §5.1/api §2 GET /impersonation/history — ImpersonationHistoryTable:
// admin, target, started/ended timestamps, duration. Task 16.2. Plain
// client-side pagination via the shared DataTable.
describe('ImpersonationHistoryTable', () => {
  it('shows an empty state when there are no rows', () => {
    render(<ImpersonationHistoryTable items={[]} hasMore={false} onLoadMore={jest.fn()} />);
    expect(screen.getByRole('status')).toHaveTextContent(/no impersonation sessions/i);
    expect(screen.queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument();
  });

  it('offers "Clear filters" in the empty state when onClearFilters is passed', () => {
    const onClearFilters = jest.fn();
    render(<ImpersonationHistoryTable items={[]} hasMore={false} onLoadMore={jest.fn()} onClearFilters={onClearFilters} />);

    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(onClearFilters).toHaveBeenCalled();
  });

  it('marks the table busy while refreshing', () => {
    render(<ImpersonationHistoryTable items={[row()]} hasMore={false} onLoadMore={jest.fn()} isRefreshing />);

    expect(screen.getByRole('table', { name: 'Impersonation history' })).toHaveAttribute('aria-busy', 'true');
  });

  it('renders a header row with the column names and no actions column', () => {
    render(<ImpersonationHistoryTable items={[row()]} hasMore={false} onLoadMore={jest.fn()} />);

    expect(screen.getAllByRole('columnheader').map((header) => header.textContent)).toEqual(['Admin', 'Target', 'Started', 'Ended', 'Duration']);
  });

  it('renders admin, target, and duration for a completed session', () => {
    render(<ImpersonationHistoryTable items={[row()]} hasMore={false} onLoadMore={jest.fn()} />);

    const tableRow = screen.getByRole('row', { name: /ada admin/i });
    expect(tableRow).toHaveTextContent('Ada Admin');
    expect(tableRow).toHaveTextContent('Tom Trainer');
    expect(tableRow).toHaveTextContent('20m 0s');
  });

  it('renders "In progress" for a session with no endedAt/durationSeconds yet', () => {
    render(<ImpersonationHistoryTable items={[row({ endedAt: null, durationSeconds: null })]} hasMore={false} onLoadMore={jest.fn()} />);

    expect(screen.getByRole('row', { name: /ada admin/i })).toHaveTextContent(/in progress/i);
  });

  it('calls onLoadMore from "Next" on the last loaded page when hasMore is true', () => {
    const onLoadMore = jest.fn();
    render(<ImpersonationHistoryTable items={[row()]} hasMore onLoadMore={onLoadMore} />);

    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(onLoadMore).toHaveBeenCalled();
  });

  it('disables "Next" when hasMore is false', () => {
    render(<ImpersonationHistoryTable items={[row()]} hasMore={false} onLoadMore={jest.fn()} />);
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled();
  });
});
