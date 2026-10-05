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

    expect(screen.getByRole('status')).toHaveTextContent(/no players/i);
    expect(screen.queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument();
  });

  it('offers "Clear filters" in the empty state when onClearFilters is passed', () => {
    const onClearFilters = jest.fn();
    render(<PlayerRosterTable items={[]} hasMore={false} onLoadMore={jest.fn()} onClearFilters={onClearFilters} />);

    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(onClearFilters).toHaveBeenCalled();
  });

  it('marks the table busy while refreshing', () => {
    render(<PlayerRosterTable items={ROWS} hasMore={false} onLoadMore={jest.fn()} isRefreshing />);

    expect(screen.getByRole('table', { name: 'Player roster' })).toHaveAttribute('aria-busy', 'true');
  });

  it('renders a header row with the column names and no actions column', () => {
    render(<PlayerRosterTable items={ROWS} hasMore={false} onLoadMore={jest.fn()} />);

    expect(screen.getAllByRole('columnheader').map((header) => header.textContent)).toEqual(['Player', 'Age', 'Availability']);
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

  it('calls onLoadMore from "Next" on the last loaded page when hasMore is true', () => {
    const onLoadMore = jest.fn();
    render(<PlayerRosterTable items={ROWS} hasMore onLoadMore={onLoadMore} />);

    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(onLoadMore).toHaveBeenCalled();
  });

  it('adds an Actions column with a Remove icon action per row when onRemove is passed', () => {
    const onRemove = jest.fn();
    render(<PlayerRosterTable items={ROWS} hasMore={false} onLoadMore={jest.fn()} onRemove={onRemove} />);

    expect(screen.getAllByRole('columnheader').map((header) => header.textContent)).toEqual(['Player', 'Age', 'Availability', 'Actions']);
    const removeAlex = screen.getByRole('button', { name: 'Remove Alex' });
    expect(removeAlex).toHaveAttribute('title', 'Remove Alex');
    fireEvent.click(removeAlex);

    expect(onRemove).toHaveBeenCalledWith(ROWS[0]);
  });
});
