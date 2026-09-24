import { fireEvent, render, screen } from '@testing-library/react';

import { PlayerRosterTable, type RosterRow } from './PlayerRosterTable';

const ROWS: RosterRow[] = [
  { playerProfileId: 'profile-1', name: 'Alex', age: 10, availabilitySummary: 'Mon 5-8pm, Wed 6-9pm' },
  { playerProfileId: 'profile-2', name: 'Maya', age: 12, availabilitySummary: '' },
];

// fe §4.4 — PlayerRosterTable: `GET /trainers/:id/players` — explicitly the
// FR-070 narrow slice `{player, age, availabilitySummary}` only, no
// notes/tags/pipeline (architecture §18). Task 14.9.
describe('PlayerRosterTable', () => {
  it('shows an empty state when there are no players', () => {
    render(<PlayerRosterTable items={[]} hasMore={false} onLoadMore={jest.fn()} />);

    expect(screen.getByText(/no players/i)).toBeInTheDocument();
  });

  it('renders a row per player with name, age, and availabilitySummary', () => {
    render(<PlayerRosterTable items={ROWS} hasMore={false} onLoadMore={jest.fn()} />);

    expect(screen.getByRole('row', { name: /alex/i })).toHaveTextContent('10');
    expect(screen.getByRole('row', { name: /alex/i })).toHaveTextContent('Mon 5-8pm, Wed 6-9pm');
  });

  it('shows a placeholder when availabilitySummary is empty rather than a blank cell', () => {
    render(<PlayerRosterTable items={ROWS} hasMore={false} onLoadMore={jest.fn()} />);

    expect(screen.getByRole('row', { name: /maya/i })).toHaveTextContent('No availability set');
  });

  it('shows a "Load more" button when hasMore, and calls onLoadMore', () => {
    const onLoadMore = jest.fn();
    render(<PlayerRosterTable items={ROWS} hasMore onLoadMore={onLoadMore} />);

    fireEvent.click(screen.getByRole('button', { name: /load more/i }));
    expect(onLoadMore).toHaveBeenCalled();
  });
});
