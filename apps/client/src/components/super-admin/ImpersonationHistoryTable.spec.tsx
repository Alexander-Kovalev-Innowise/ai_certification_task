import { render, screen } from '@testing-library/react';

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
// "Load more" pagination (not virtualized, per the coordinator's guidance —
// this audit list has no NFR-002-style 10k-row target the way `/users` does).
describe('ImpersonationHistoryTable', () => {
  it('shows an empty state when there are no rows', () => {
    render(<ImpersonationHistoryTable items={[]} hasMore={false} onLoadMore={jest.fn()} />);
    expect(screen.getByRole('status')).toHaveTextContent(/no impersonation sessions/i);
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

  it('shows a Load more button when hasMore is true and calls onLoadMore when clicked', () => {
    const onLoadMore = jest.fn();
    render(<ImpersonationHistoryTable items={[row()]} hasMore onLoadMore={onLoadMore} />);

    screen.getByRole('button', { name: /load more/i }).click();
    expect(onLoadMore).toHaveBeenCalled();
  });

  it('does not show a Load more button when hasMore is false', () => {
    render(<ImpersonationHistoryTable items={[row()]} hasMore={false} onLoadMore={jest.fn()} />);
    expect(screen.queryByRole('button', { name: /load more/i })).not.toBeInTheDocument();
  });
});
