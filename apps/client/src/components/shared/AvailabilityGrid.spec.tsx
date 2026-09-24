import { fireEvent, render, screen } from '@testing-library/react';

import { formatAvailabilitySummary } from '../../lib/formatting/availability-summary.formatter';

import { AvailabilityGrid, type AvailabilityGridSlot } from './AvailabilityGrid';

const VIEW_SLOTS: AvailabilityGridSlot[] = [
  { dayOfWeek: 1, startTime: 17 * 60, endTime: 20 * 60, isAvailable: true },
  { dayOfWeek: 3, startTime: 18 * 60, endTime: 21 * 60, isAvailable: true },
];

// fe §5.4 — AvailabilityGrid: one component, two subjects (player|coach),
// two modes (view|edit). `startTime`/`endTime` are minutes-from-midnight on
// the wire; converts to/from a human HH:mm picker only at the edit
// boundary — no timezone conversion anywhere (OQ-5's trainer-local
// wall-clock design). Task 14.6.
describe('AvailabilityGrid', () => {
  describe('view mode', () => {
    it("renders a summary string matching availability-summary.formatter's output for the same slots", () => {
      render(<AvailabilityGrid subject="player" mode="view" slots={VIEW_SLOTS} />);

      expect(screen.getByTestId('availability-summary')).toHaveTextContent(formatAvailabilitySummary(VIEW_SLOTS));
    });

    it('renders each available slot under its day as an HH:mm range', () => {
      render(<AvailabilityGrid subject="coach" mode="view" slots={VIEW_SLOTS} />);

      expect(screen.getByRole('row', { name: 'Mon' })).toHaveTextContent('17:00-20:00');
      expect(screen.getByRole('row', { name: 'Wed' })).toHaveTextContent('18:00-21:00');
    });
  });

  describe('edit mode', () => {
    it('adds a time-range row for a day with HH:mm pickers seeded from minutes-from-midnight', () => {
      const slots: AvailabilityGridSlot[] = [{ dayOfWeek: 1, startTime: 17 * 60 + 5, endTime: 20 * 60 + 30, isAvailable: true }];
      render(<AvailabilityGrid subject="player" mode="edit" slots={slots} onSave={jest.fn()} />);

      const startInput = screen.getByLabelText(/mon.*start/i) as HTMLInputElement;
      const endInput = screen.getByLabelText(/mon.*end/i) as HTMLInputElement;
      expect(startInput.value).toBe('17:05');
      expect(endInput.value).toBe('20:30');
    });

    it('round-trips an edited HH:mm value back to minutes-from-midnight without drift on save', () => {
      const slots: AvailabilityGridSlot[] = [{ dayOfWeek: 1, startTime: 17 * 60, endTime: 20 * 60, isAvailable: true }];
      const onSave = jest.fn();
      render(<AvailabilityGrid subject="player" mode="edit" slots={slots} onSave={onSave} />);

      fireEvent.change(screen.getByLabelText(/mon.*start/i), { target: { value: '18:15' } });
      fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

      expect(onSave).toHaveBeenCalledWith([expect.objectContaining({ dayOfWeek: 1, startTime: 18 * 60 + 15, endTime: 20 * 60 })]);
    });

    it('adds a new row via "+ Add time" for the given day', () => {
      const onSave = jest.fn();
      render(<AvailabilityGrid subject="player" mode="edit" slots={[]} onSave={onSave} />);

      fireEvent.click(screen.getAllByRole('button', { name: /add time/i })[1] as HTMLElement); // Mon
      fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

      expect(onSave).toHaveBeenCalledWith([expect.objectContaining({ dayOfWeek: 1, isAvailable: true })]);
    });

    it('removes a row', () => {
      const slots: AvailabilityGridSlot[] = [{ dayOfWeek: 1, startTime: 17 * 60, endTime: 20 * 60, isAvailable: true }];
      const onSave = jest.fn();
      render(<AvailabilityGrid subject="player" mode="edit" slots={slots} onSave={onSave} />);

      fireEvent.click(screen.getByRole('button', { name: /^remove$/i }));
      fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

      expect(onSave).toHaveBeenCalledWith([]);
    });

    it('blocks save and shows an error when startTime >= endTime', () => {
      const slots: AvailabilityGridSlot[] = [{ dayOfWeek: 1, startTime: 17 * 60, endTime: 20 * 60, isAvailable: true }];
      const onSave = jest.fn();
      render(<AvailabilityGrid subject="player" mode="edit" slots={slots} onSave={onSave} />);

      fireEvent.change(screen.getByLabelText(/mon.*start/i), { target: { value: '21:00' } });
      fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

      expect(screen.getByRole('alert')).toHaveTextContent(/start time must be before end time/i);
      expect(onSave).not.toHaveBeenCalled();
    });
  });
});
