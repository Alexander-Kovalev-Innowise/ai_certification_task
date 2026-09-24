import { fireEvent, render, screen } from '@testing-library/react';

import { AvailabilityFilterBar, type AvailabilityFilter } from './AvailabilityFilterBar';

// fe §4.4 — AvailabilityFilterBar: `/players`' day/time filter for
// `GET /trainers/:id/players` (`?dayOfWeek&startTime&endTime`). Task 14.9.
describe('AvailabilityFilterBar', () => {
  it('calls onChange with the selected dayOfWeek', () => {
    const onChange = jest.fn();
    render(<AvailabilityFilterBar value={{}} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText(/day/i), { target: { value: '1' } });

    expect(onChange).toHaveBeenCalledWith({ dayOfWeek: 1 });
  });

  it('calls onChange with startTime/endTime converted from HH:mm to minutes-from-midnight', () => {
    const onChange = jest.fn();
    render(<AvailabilityFilterBar value={{ dayOfWeek: 1 }} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText(/from/i), { target: { value: '17:00' } });
    expect(onChange).toHaveBeenCalledWith({ dayOfWeek: 1, startTime: 17 * 60 });

    fireEvent.change(screen.getByLabelText(/to/i), { target: { value: '20:00' } });
    expect(onChange).toHaveBeenCalledWith({ dayOfWeek: 1, endTime: 20 * 60 });
  });

  it('clears all filters when "Clear" is clicked', () => {
    const onChange = jest.fn();
    const value: AvailabilityFilter = { dayOfWeek: 1, startTime: 17 * 60, endTime: 20 * 60 };
    render(<AvailabilityFilterBar value={value} onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: /clear/i }));

    expect(onChange).toHaveBeenCalledWith({});
  });
});
