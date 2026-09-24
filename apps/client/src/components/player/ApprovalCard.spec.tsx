import { fireEvent, render, screen } from '@testing-library/react';

import { ApprovalCard, type ApprovalRow } from './ApprovalCard';

function approval(overrides: Partial<ApprovalRow> = {}): ApprovalRow {
  return {
    id: 'approval-1',
    playerProfileId: 'profile-2',
    playerName: 'Alex',
    eventId: 'event-1',
    amount: '25.00',
    paymentType: 'USD',
    status: 'PENDING',
    requestedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
    ...overrides,
  };
}

// fe §9.1 — ApprovalCard: per-status rendering — PENDING (live countdown,
// --warning/--danger thresholds at 6h/1h remaining, Approve/Deny active),
// APPROVED/DENIED (static badge), EXPIRED (distinct muted treatment, not
// styled like an active denial). Task 14.8.
describe('ApprovalCard', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('shows a live countdown and active Approve/Deny buttons for PENDING', () => {
    render(<ApprovalCard approval={approval({ expiresAt: new Date(Date.now() + 10 * 60 * 60 * 1000).toISOString() })} onApprove={jest.fn()} onDeny={jest.fn()} />);

    expect(screen.getByTestId('approval-countdown')).toHaveTextContent(/remaining/i);
    expect(screen.getByRole('button', { name: /approve/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /deny/i })).toBeInTheDocument();
  });

  it('calls onApprove/onDeny when clicked', () => {
    const onApprove = jest.fn();
    const onDeny = jest.fn();
    render(<ApprovalCard approval={approval()} onApprove={onApprove} onDeny={onDeny} />);

    fireEvent.click(screen.getByRole('button', { name: /approve/i }));
    expect(onApprove).toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /deny/i }));
    expect(onDeny).toHaveBeenCalled();
  });

  it('shows the --warning threshold under 6 hours remaining', () => {
    render(<ApprovalCard approval={approval({ expiresAt: new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString() })} onApprove={jest.fn()} onDeny={jest.fn()} />);

    expect(screen.getByTestId('approval-countdown')).toHaveStyle({ color: 'var(--warning)' });
  });

  it('shows the --danger threshold under 1 hour remaining', () => {
    render(<ApprovalCard approval={approval({ expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString() })} onApprove={jest.fn()} onDeny={jest.fn()} />);

    expect(screen.getByTestId('approval-countdown')).toHaveStyle({ color: 'var(--danger)' });
  });

  it('renders a static APPROVED badge with decision timestamp and no actions', () => {
    render(<ApprovalCard approval={approval({ status: 'APPROVED', respondedAt: '2026-01-05T12:00:00.000Z', parentNotes: 'Approved, have fun!' })} />);

    expect(screen.getByText('APPROVED')).toBeInTheDocument();
    expect(screen.getByText(/approved, have fun/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /approve/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /deny/i })).not.toBeInTheDocument();
  });

  it('renders a static DENIED badge with no actions', () => {
    render(<ApprovalCard approval={approval({ status: 'DENIED', respondedAt: '2026-01-05T12:00:00.000Z' })} />);

    expect(screen.getByText('DENIED')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /approve/i })).not.toBeInTheDocument();
  });

  it('renders a distinct muted EXPIRED treatment, not styled like an active denial', () => {
    render(<ApprovalCard approval={approval({ status: 'EXPIRED' })} />);

    expect(screen.getByText(/expired — no response within 48 hours/i)).toBeInTheDocument();
    expect(screen.queryByText('DENIED')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /approve/i })).not.toBeInTheDocument();
  });
});
