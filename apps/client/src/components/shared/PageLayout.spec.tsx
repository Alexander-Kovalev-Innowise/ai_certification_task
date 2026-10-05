import { render, screen } from '@testing-library/react';

import { PageHeader, PageLayout } from './PageLayout';

describe('PageLayout', () => {
  it('renders children in a section with the shared page rhythm and passes aria props through', () => {
    render(
      <PageLayout aria-busy="true" aria-label="Loading things" className="extra">
        <p>content</p>
      </PageLayout>,
    );

    const section = screen.getByLabelText('Loading things');
    expect(section.tagName).toBe('SECTION');
    expect(section).toHaveAttribute('aria-busy', 'true');
    expect(section).toHaveClass('flex', 'flex-1', 'flex-col', 'gap-lg', 'p-lg', 'extra');
    expect(screen.getByText('content')).toBeInTheDocument();
  });
});

describe('PageHeader', () => {
  it('renders the title as a level-1 heading with the given id', () => {
    render(<PageHeader title="Users" titleId="users-heading" />);

    const heading = screen.getByRole('heading', { level: 1, name: 'Users' });
    expect(heading).toHaveAttribute('id', 'users-heading');
  });

  it('keeps a 40px minimum height with or without actions', () => {
    const { rerender } = render(<PageHeader title="Users" />);
    expect(screen.getByRole('banner')).toHaveClass('min-h-[40px]');

    rerender(<PageHeader title="Users" actions={<button type="button">Create</button>} />);
    expect(screen.getByRole('banner')).toHaveClass('min-h-[40px]');
    expect(screen.getByRole('button', { name: 'Create' })).toBeInTheDocument();
  });

  it('renders no actions container when actions are omitted', () => {
    const { container } = render(<PageHeader title="Users" />);
    expect(container.querySelectorAll('header > div')).toHaveLength(1);
  });

  it('renders the subtitle under the title without moving the title slot', () => {
    render(<PageHeader title="Users" subtitle="All accounts" />);

    expect(screen.getByText('All accounts')).toBeInTheDocument();
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading.parentElement).toHaveClass('min-h-[40px]', 'items-center');
  });
});
