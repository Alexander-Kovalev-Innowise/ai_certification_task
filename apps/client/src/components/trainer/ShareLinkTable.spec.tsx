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

    expect(screen.getByRole('status')).toHaveTextContent(/no share links yet/i);
    expect(screen.queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument();
  });

  it('marks the table busy while refreshing', () => {
    render(<ShareLinkTable items={[makeRow()]} hasMore={false} onLoadMore={jest.fn()} onRevoke={jest.fn()} isRefreshing />);

    expect(screen.getByRole('table', { name: 'Share links' })).toHaveAttribute('aria-busy', 'true');
  });

  it('renders a header row with the column names, ending in an Actions column', () => {
    render(<ShareLinkTable items={[makeRow()]} hasMore={false} onLoadMore={jest.fn()} onRevoke={jest.fn()} />);

    expect(screen.getAllByRole('columnheader').map((header) => header.textContent)).toEqual([
      'Code',
      'Type',
      'Target email',
      'Uses',
      'Expires',
      'Status',
      'Actions',
    ]);
  });

  it('fades a row whose revoke is pending', () => {
    const items = [makeRow({ id: 'link-p', code: 'pend1' })];

    render(<ShareLinkTable items={items} hasMore={false} onLoadMore={jest.fn()} onRevoke={jest.fn()} pendingRevokeIds={['link-p']} />);

    expect(screen.getByRole('row', { name: 'pend1' })).toHaveClass('opacity-40');
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

  it('calls onLoadMore from "Next" on the last loaded page when there are more rows', () => {
    const onLoadMore = jest.fn();
    render(<ShareLinkTable items={[makeRow()]} hasMore onLoadMore={onLoadMore} onRevoke={jest.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));

    expect(onLoadMore).toHaveBeenCalled();
  });
});
