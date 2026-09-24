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

    expect(screen.getByText(/no coaches/i)).toBeInTheDocument();
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

    fireEvent.click(screen.getByRole('button', { name: /set to pending/i }));

    expect(onStatusChange).toHaveBeenCalledWith('coach-1', 'PENDING');
  });

  it('offers a resend action for an expired invite and calls onResend with its email/name', () => {
    const onResend = jest.fn();
    const items = [makeRow({ id: 'link-1', userId: null, name: 'Cam Coach', email: 'cam@example.com', invitationStatus: 'Expired', status: 'EXPIRED', joinedAt: null })];

    render(<CoachRosterTable items={items} hasMore={false} onLoadMore={jest.fn()} onStatusChange={jest.fn()} onResend={onResend} />);

    fireEvent.click(screen.getByRole('button', { name: /resend invite/i }));

    expect(onResend).toHaveBeenCalledWith({ email: 'cam@example.com', name: 'Cam Coach' });
  });

  it('does not offer a status toggle or resend action for a still-outstanding pending invite', () => {
    const items = [makeRow({ id: 'link-2', userId: null, invitationStatus: 'Pending', status: 'PENDING', joinedAt: null })];

    render(<CoachRosterTable items={items} hasMore={false} onLoadMore={jest.fn()} onStatusChange={jest.fn()} onResend={jest.fn()} />);

    expect(screen.queryByRole('button', { name: /set to/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /resend invite/i })).not.toBeInTheDocument();
  });

  it('shows a "Load more" affordance and calls onLoadMore when there are more rows', () => {
    const onLoadMore = jest.fn();
    render(<CoachRosterTable items={[makeRow()]} hasMore onLoadMore={onLoadMore} onStatusChange={jest.fn()} onResend={jest.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /load more/i }));

    expect(onLoadMore).toHaveBeenCalled();
  });
});
