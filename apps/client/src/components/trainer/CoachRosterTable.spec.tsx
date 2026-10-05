import { fireEvent, render, screen } from '@testing-library/react';

import type { CoachRosterRow } from './CoachRosterTable';
import { CoachRosterTable } from './CoachRosterTable';

function makeRow(overrides: Partial<CoachRosterRow> = {}): CoachRosterRow {
  return {
    id: 'row-1',
    userId: 'user-1',
    name: 'Cam Coach',
    email: 'cam@example.com',
    status: 'ACTIVE',
    bio: null,
    joinedAt: '2026-01-01T00:00:00.000Z',
    invitationStatus: 'Accepted',
    ...overrides,
  };
}

// fe §4.4 — CoachRosterTable: renders GET /trainers/:id/coaches rows, a
// CoachStatusBadge per row, a status toggle for accepted coaches (PATCH
// /coaches/:id), and a resend action for expired invites. Task 13.2.
describe('CoachRosterTable', () => {
  it('shows an empty state when there are no coaches', () => {
    render(<CoachRosterTable items={[]} hasMore={false} onLoadMore={jest.fn()} onStatusChange={jest.fn()} onResend={jest.fn()} />);

    expect(screen.getByRole('status')).toHaveTextContent(/no coaches yet/i);
    expect(screen.queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument();
  });

  it('marks the table busy while refreshing', () => {
    render(<CoachRosterTable items={[makeRow()]} hasMore={false} onLoadMore={jest.fn()} onStatusChange={jest.fn()} onResend={jest.fn()} isRefreshing />);

    expect(screen.getByRole('table', { name: 'Coach roster' })).toHaveAttribute('aria-busy', 'true');
  });

  it('renders a header row with the column names, ending in an Actions column', () => {
    render(<CoachRosterTable items={[makeRow()]} hasMore={false} onLoadMore={jest.fn()} onStatusChange={jest.fn()} onResend={jest.fn()} />);

    expect(screen.getAllByRole('columnheader').map((header) => header.textContent)).toEqual(['Name', 'Email', 'Status', 'Joined', 'Actions']);
  });

  it('renders each row with name, email and its invitation-status badge', () => {
    const items = [
      makeRow({ id: 'row-1', name: 'Cam Coach', invitationStatus: 'Accepted' }),
      makeRow({ id: 'row-2', name: null, email: 'pending@example.com', userId: null, invitationStatus: 'Pending', status: 'PENDING' }),
    ];

    render(<CoachRosterTable items={items} hasMore={false} onLoadMore={jest.fn()} onStatusChange={jest.fn()} onResend={jest.fn()} />);

    expect(screen.getByRole('row', { name: /cam coach/i })).toBeInTheDocument();
    expect(screen.getAllByText('pending@example.com').length).toBeGreaterThan(0);
    expect(screen.getByText('Accepted')).toBeInTheDocument();
    expect(screen.getByText('Pending')).toBeInTheDocument();
  });

  it('offers a status toggle for an accepted coach and calls onStatusChange with the opposite status', () => {
    const onStatusChange = jest.fn();
    const items = [makeRow({ id: 'coach-1', status: 'ACTIVE', invitationStatus: 'Accepted' })];

    render(<CoachRosterTable items={items} hasMore={false} onLoadMore={jest.fn()} onStatusChange={onStatusChange} onResend={jest.fn()} />);

    const toggle = screen.getByRole('button', { name: /set to pending/i });
    expect(toggle).toHaveAttribute('title', 'Set to Pending');
    fireEvent.click(toggle);

    expect(onStatusChange).toHaveBeenCalledWith('coach-1', 'PENDING');
  });

  it('offers a resend action for an expired invite and calls onResend with the row', () => {
    const onResend = jest.fn();
    const row = makeRow({ id: 'link-1', userId: null, name: null, email: 'cam@example.com', invitationStatus: 'Expired', status: 'EXPIRED', joinedAt: null });

    render(<CoachRosterTable items={[row]} hasMore={false} onLoadMore={jest.fn()} onStatusChange={jest.fn()} onResend={onResend} />);

    fireEvent.click(screen.getByRole('button', { name: /resend invite/i }));

    expect(onResend).toHaveBeenCalledWith(row);
  });

  it('also offers resend for a still-pending invite, and shows its expiry caption', () => {
    const onResend = jest.fn();
    const row = makeRow({ id: 'link-2', userId: null, name: null, invitationStatus: 'Pending', status: 'PENDING', joinedAt: null, expiresAt: '2030-01-10T00:00:00.000Z' });

    render(<CoachRosterTable items={[row]} hasMore={false} onLoadMore={jest.fn()} onStatusChange={jest.fn()} onResend={onResend} onRemove={jest.fn()} />);

    expect(screen.getByText(/^Expires /)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /resend invite/i }));
    expect(onResend).toHaveBeenCalledWith(row);
    expect(screen.queryByRole('button', { name: /set to/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^remove /i })).not.toBeInTheDocument();
  });

  it('shows an "Expired <date>" caption for an expired invite', () => {
    const row = makeRow({ id: 'link-3', userId: null, invitationStatus: 'Expired', status: 'EXPIRED', joinedAt: null, expiresAt: '2026-01-10T00:00:00.000Z' });
    render(<CoachRosterTable items={[row]} hasMore={false} onLoadMore={jest.fn()} onStatusChange={jest.fn()} onResend={jest.fn()} />);

    expect(screen.getByText(/^Expired \d/)).toBeInTheDocument();
  });

  it('offers Check availability + Remove icon actions for an ACTIVE coach', () => {
    const onAssign = jest.fn();
    const onRemove = jest.fn();
    const row = makeRow({ id: 'coach-1', status: 'ACTIVE' });

    render(<CoachRosterTable items={[row]} hasMore={false} onLoadMore={jest.fn()} onStatusChange={jest.fn()} onResend={jest.fn()} onAssign={onAssign} onRemove={onRemove} />);

    fireEvent.click(screen.getByRole('button', { name: /check availability \/ assign cam coach to session/i }));
    expect(onAssign).toHaveBeenCalledWith(row);
    fireEvent.click(screen.getByRole('button', { name: 'Remove Cam Coach' }));
    expect(onRemove).toHaveBeenCalledWith(row);
  });

  it('does not offer assign for a PENDING coach (only ACTIVE coaches can be assigned)', () => {
    const row = makeRow({ id: 'coach-2', status: 'PENDING' });
    render(<CoachRosterTable items={[row]} hasMore={false} onLoadMore={jest.fn()} onStatusChange={jest.fn()} onResend={jest.fn()} onAssign={jest.fn()} onRemove={jest.fn()} />);

    expect(screen.queryByRole('button', { name: /check availability/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^remove /i })).toBeInTheDocument();
  });

  it('calls onLoadMore from "Next" on the last loaded page when there are more rows', () => {
    const onLoadMore = jest.fn();
    render(<CoachRosterTable items={[makeRow()]} hasMore onLoadMore={onLoadMore} onStatusChange={jest.fn()} onResend={jest.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));

    expect(onLoadMore).toHaveBeenCalled();
  });
});
