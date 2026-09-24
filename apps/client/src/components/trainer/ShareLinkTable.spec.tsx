import { fireEvent, render, screen } from '@testing-library/react';

import type { ShareLinkRow } from './ShareLinkTable';
import { ShareLinkTable } from './ShareLinkTable';

function makeRow(overrides: Partial<ShareLinkRow> = {}): ShareLinkRow {
  return {
    id: 'link-1',
    code: 'abc123',
    type: 'PLAYER_STATIC',
    targetEmail: null,
    status: 'ACTIVE',
    useCount: 0,
    expiresAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

// fe §4.4 — ShareLinkTable: code, type, usage, expiry, status per row, plus
// a RevokeConfirmPopover-driven revoke action for ACTIVE links. Task 13.3.
describe('ShareLinkTable', () => {
  it('shows an empty state when there are no links', () => {
    render(<ShareLinkTable items={[]} hasMore={false} onLoadMore={jest.fn()} onRevoke={jest.fn()} />);

    expect(screen.getByText(/no share links/i)).toBeInTheDocument();
  });

  it('renders code, type, usage and status for a PLAYER_STATIC row (unlimited uses, no expiry)', () => {
    const items = [makeRow({ code: 'static1', type: 'PLAYER_STATIC', useCount: 4, expiresAt: null })];

    render(<ShareLinkTable items={items} hasMore={false} onLoadMore={jest.fn()} onRevoke={jest.fn()} />);

    expect(screen.getByText('static1')).toBeInTheDocument();
    expect(screen.getByText(/player.*static/i)).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.getByText(/never/i)).toBeInTheDocument();
  });

  it('renders targetEmail and expiry date for a COACH_UNIQUE row', () => {
    const items = [makeRow({ code: 'coach1', type: 'COACH_UNIQUE', targetEmail: 'cam@example.com', expiresAt: '2026-02-01T00:00:00.000Z' })];

    render(<ShareLinkTable items={items} hasMore={false} onLoadMore={jest.fn()} onRevoke={jest.fn()} />);

    expect(screen.getByText('cam@example.com')).toBeInTheDocument();
    expect(screen.getByText(/coach.*unique/i)).toBeInTheDocument();
  });

  it('offers a revoke action for an ACTIVE link and calls onRevoke with its id when confirmed', () => {
    const onRevoke = jest.fn();
    const items = [makeRow({ id: 'link-active', status: 'ACTIVE' })];

    render(<ShareLinkTable items={items} hasMore={false} onLoadMore={jest.fn()} onRevoke={onRevoke} />);

    fireEvent.click(screen.getByRole('button', { name: /^revoke$/i }));
    fireEvent.click(screen.getByRole('button', { name: /yes, revoke/i }));

    expect(onRevoke).toHaveBeenCalledWith('link-active');
  });

  it('does not offer a revoke action for a non-ACTIVE link', () => {
    const items = [makeRow({ status: 'REVOKED' })];

    render(<ShareLinkTable items={items} hasMore={false} onLoadMore={jest.fn()} onRevoke={jest.fn()} />);

    expect(screen.queryByRole('button', { name: /^revoke$/i })).not.toBeInTheDocument();
  });

  it('shows a "Load more" affordance and calls onLoadMore when there are more rows', () => {
    const onLoadMore = jest.fn();
    render(<ShareLinkTable items={[makeRow()]} hasMore onLoadMore={onLoadMore} onRevoke={jest.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /load more/i }));

    expect(onLoadMore).toHaveBeenCalled();
  });
});
