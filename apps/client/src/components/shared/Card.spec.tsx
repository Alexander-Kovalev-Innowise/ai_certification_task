import { render, screen } from '@testing-library/react';

import { Card, CardFooter, CardHeader, CardSection } from './Card';

describe('Card', () => {
  it('renders the title as an h1 with the badge slot and subtitle', () => {
    render(
      <Card>
        <CardHeader title="Ada Lovelace" subtitle="Analyst" badge={<span>ACTIVE</span>} />
      </Card>,
    );

    expect(screen.getByRole('heading', { level: 1, name: 'Ada Lovelace' })).toBeInTheDocument();
    expect(screen.getByText('ACTIVE')).toBeInTheDocument();
    expect(screen.getByText('Analyst')).toBeInTheDocument();
  });

  it('renders the title at the level given by titleAs', () => {
    render(
      <Card>
        <CardHeader title="Ada Lovelace" titleAs="h2" />
      </Card>,
    );

    expect(screen.getByRole('heading', { level: 2, name: 'Ada Lovelace' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument();
  });

  it('renders sections as labelled regions with an eyebrow heading', () => {
    render(
      <Card>
        <CardSection heading="Account">
          <p>content</p>
        </CardSection>
      </Card>,
    );

    expect(screen.getByRole('region', { name: 'Account' })).toHaveTextContent('content');
    expect(screen.getByRole('heading', { level: 2, name: 'Account' })).toHaveClass('uppercase');
  });

  it('renders footer children and uses a solid surface card', () => {
    const { container } = render(
      <Card>
        <CardFooter>
          <button type="button">Cancel</button>
        </CardFooter>
      </Card>,
    );

    expect(screen.getByRole('button', { name: 'Cancel' }).closest('[data-slot="card-footer"]')).not.toBeNull();
    expect(container.firstChild).toHaveClass('bg-surface-1');
    expect(container.firstChild).toHaveClass('shadow-card-soft');
  });
});
