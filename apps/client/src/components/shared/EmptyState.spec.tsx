import { render, screen } from '@testing-library/react';

import { EmptyState } from './EmptyState';

describe('EmptyState', () => {
  it('renders the title as a status, plus the description', () => {
    render(<EmptyState title="Nothing here" description="Try adjusting your filters." />);

    expect(screen.getByRole('status')).toHaveTextContent('Nothing here');
    expect(screen.getByText('Try adjusting your filters.')).toBeInTheDocument();
  });

  it('renders a decorative icon tile', () => {
    render(<EmptyState title="Nothing here" icon="inbox" />);

    expect(screen.getByTestId('empty-state-icon')).toHaveAttribute('aria-hidden', 'true');
  });

  it('renders the action slot only when provided', () => {
    const { rerender } = render(<EmptyState title="Nothing here" />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();

    rerender(<EmptyState title="Nothing here" action={<button type="button">Clear filters</button>} />);
    expect(screen.getByRole('button', { name: 'Clear filters' })).toBeInTheDocument();
  });
});
