import { render, screen } from '@testing-library/react';

import { StatCard, StatCardSkeleton } from './StatCard';

describe('StatCard', () => {
  it('renders the value in a tabular-number element with its label and hint', () => {
    render(<StatCard label="Connected players" value={1234} hint="Active connections" icon="users" />);

    expect(screen.getByText('1,234')).toHaveClass('font-numeric');
    expect(screen.getByText('Connected players')).toBeInTheDocument();
    expect(screen.getByText('Active connections')).toBeInTheDocument();
  });

  it('adds a unit suffix for percent and hours', () => {
    const { rerender } = render(<StatCard label="Coverage" value={40} unit="percent" icon="calendar" />);
    expect(screen.getByText('%')).toBeInTheDocument();

    rerender(<StatCard label="Hours" value={3.5} unit="hours" icon="clock" />);
    expect(screen.getByText('3.5')).toBeInTheDocument();
    expect(screen.getByText('h')).toBeInTheDocument();
  });

  it.each([
    ['up', 'text-success', /up 4 versus the previous 30 days/i],
    ['down', 'text-danger', /down 4 versus the previous 30 days/i],
    ['flat', 'text-ink-muted', /no change versus the previous 30 days/i],
  ] as const)('colours a %s delta pill with theme tokens', (direction, colourClass, description) => {
    render(<StatCard label="New" value={9} icon="user-plus" delta={{ value: 4, period: 'month', direction }} />);

    const pill = screen.getByTestId('stat-delta');
    expect(pill).toHaveClass(colourClass);
    expect(pill).toHaveAttribute('data-direction', direction);
    expect(pill).toHaveTextContent(description);
  });

  it('describes a weekly delta against the previous 7 days', () => {
    render(<StatCard label="Sessions" value={2} icon="shield" delta={{ value: 1, period: 'week', direction: 'up' }} />);

    expect(screen.getByTestId('stat-delta')).toHaveTextContent(/previous 7 days/i);
  });

  it('renders the whole card as a link when href is provided', () => {
    render(<StatCard label="Pending Approvals" value={3} icon="check-circle" href="/approvals" />);

    expect(screen.getByRole('link', { name: /pending approvals/i })).toHaveAttribute('href', '/approvals');
  });

  it('renders children (e.g. a sparkline slot)', () => {
    render(
      <StatCard label="X" value={1} icon="bar-chart">
        <span>slot</span>
      </StatCard>,
    );

    expect(screen.getByText('slot')).toBeInTheDocument();
  });

  it('exposes an aria-hidden skeleton', () => {
    render(<StatCardSkeleton />);

    expect(screen.getByTestId('stat-card-skeleton')).toHaveAttribute('aria-hidden', 'true');
  });
});
