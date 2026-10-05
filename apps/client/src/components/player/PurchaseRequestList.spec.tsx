import { render, screen } from '@testing-library/react';

import { PurchaseRequestList, formatRequestAmount, type PurchaseRequestRow } from './PurchaseRequestList';

function row(overrides: Partial<PurchaseRequestRow>): PurchaseRequestRow {
  return {
    id: 'r1',
    title: 'Skills clinic',
    amount: '25',
    paymentType: 'USD',
    status: 'PENDING',
    requestedAt: '2026-01-01T00:00:00.000Z',
    expiresAt: '2026-01-03T00:00:00.000Z',
    ...overrides,
  };
}

describe('PurchaseRequestList', () => {
  it('shows an empty state when there are no requests', () => {
    render(<PurchaseRequestList requests={[]} />);

    expect(screen.getByText('No requests yet')).toBeInTheDocument();
  });

  it.each([
    ['PENDING', 'Pending Parent Approval'],
    ['APPROVED', 'Confirmed'],
    ['DENIED', 'Denied'],
    ['EXPIRED', 'Expired'],
  ] as const)('labels a %s request as "%s"', (status, label) => {
    render(<PurchaseRequestList requests={[row({ status })]} />);

    expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.getByText('Skills clinic')).toBeInTheDocument();
  });

  it('shows the parent\'s question while pending and their note once decided', () => {
    render(
      <PurchaseRequestList
        requests={[
          row({ id: 'a', infoRequestMessage: 'Which clinic?' }),
          row({ id: 'b', status: 'DENIED', parentNotes: 'Not this month', title: 'Boots' }),
        ]}
      />,
    );

    expect(screen.getByText(/Your parent asked: Which clinic\?/)).toBeInTheDocument();
    expect(screen.getByText(/Not this month/)).toBeInTheDocument();
  });

  it('formats USD and token amounts', () => {
    expect(formatRequestAmount('25', 'USD')).toBe('$25.00');
    expect(formatRequestAmount('3.5', 'TOKEN')).toBe('3.50 tokens');
  });
});
