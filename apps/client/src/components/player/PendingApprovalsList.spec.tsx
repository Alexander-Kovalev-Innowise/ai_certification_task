import { fireEvent, render, screen } from '@testing-library/react';

import type { ApprovalRow } from './ApprovalCard';
import { PendingApprovalsList } from './PendingApprovalsList';

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
    expiresAt: new Date(Date.now() + 10 * 60 * 60 * 1000).toISOString(),
    ...overrides,
  };
}

// fe §9.1 — PendingApprovalsList: renders PENDING approvals as
// ApprovalCards, plus a collapsed "recently resolved" section (last 7
// days). Empty state is not a bare "no results." Task 14.8.
describe('PendingApprovalsList', () => {
  it('shows the specific empty-state copy when there are no pending approvals', () => {
    render(<PendingApprovalsList approvals={[]} onApprove={jest.fn()} onDeny={jest.fn()} />);

    expect(screen.getByText(/no pending approvals — you're all caught up/i)).toBeInTheDocument();
  });

  it('renders a card per PENDING approval', () => {
    const approvals = [approval({ id: 'a1', playerName: 'Alex' }), approval({ id: 'a2', playerName: 'Maya' })];
    render(<PendingApprovalsList approvals={approvals} onApprove={jest.fn()} onDeny={jest.fn()} />);

    expect(screen.getByRole('article', { name: 'Alex' })).toBeInTheDocument();
    expect(screen.getByRole('article', { name: 'Maya' })).toBeInTheDocument();
  });

  it('calls onApprove/onDeny with the approval id', () => {
    const onApprove = jest.fn();
    const onDeny = jest.fn();
    render(<PendingApprovalsList approvals={[approval({ id: 'a1' })]} onApprove={onApprove} onDeny={onDeny} />);

    fireEvent.click(screen.getByRole('button', { name: /approve/i }));
    expect(onApprove).toHaveBeenCalledWith('a1');

    fireEvent.click(screen.getByRole('button', { name: /deny/i }));
    expect(onDeny).toHaveBeenCalledWith('a1');
  });

  it('shows a collapsed "recently resolved" section for non-PENDING items from the last 7 days', () => {
    const resolved = approval({ id: 'a2', status: 'APPROVED', respondedAt: new Date().toISOString() });
    render(<PendingApprovalsList approvals={[resolved]} onApprove={jest.fn()} onDeny={jest.fn()} />);

    expect(screen.getByText(/no pending approvals/i)).toBeInTheDocument();
    const details = screen.getByText(/recently resolved/i).closest('details');
    expect(details).toBeInTheDocument();
    expect(details).not.toHaveAttribute('open');
    expect(screen.getByRole('article', { name: 'Alex' })).toBeInTheDocument();
  });

  it('omits the "recently resolved" section entirely when there is nothing resolved in the last 7 days', () => {
    render(<PendingApprovalsList approvals={[approval({ status: 'PENDING' })]} onApprove={jest.fn()} onDeny={jest.fn()} />);

    expect(screen.queryByText(/recently resolved/i)).not.toBeInTheDocument();
  });
});
