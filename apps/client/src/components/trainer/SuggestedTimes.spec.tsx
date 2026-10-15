import { render, screen } from '@testing-library/react';

import { SuggestedTimes } from './SuggestedTimes';

describe('SuggestedTimes (spec US-01.09 suggest session times)', () => {
  it('lists each suggested window as "<label> - X out of Y players"', () => {
    render(
      <SuggestedTimes
        totalCount={20}
        items={[
          { dayOfWeek: 1, startTime: 1020, endTime: 1200, label: 'Mon 5:00-8:00 PM', availableCount: 12 },
          { dayOfWeek: 3, startTime: 1080, endTime: 1260, label: 'Wed 6:00-9:00 PM', availableCount: 9 },
        ]}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Suggested times' })).toBeInTheDocument();
    const items = screen.getAllByRole('listitem');
    expect(items.map((item) => item.textContent)).toEqual([
      'Mon 5:00-8:00 PM - 12 out of 20 players',
      'Wed 6:00-9:00 PM - 9 out of 20 players',
    ]);
  });

  it('explains the empty state instead of rendering an empty list', () => {
    render(<SuggestedTimes items={[]} totalCount={0} />);

    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    expect(screen.getByText(/appear once your players have set their availability/i)).toBeInTheDocument();
  });

  it('shows an error message when the suggestions could not be loaded', () => {
    render(<SuggestedTimes items={[]} totalCount={0} isError />);

    expect(screen.getByRole('alert')).toHaveTextContent(/could not load suggested times/i);
  });
});
