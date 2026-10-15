import { fireEvent, render, screen } from '@testing-library/react';

import type { HistoryFiltersValue } from './HistoryFilters';
import { HistoryFilters } from './HistoryFilters';

const EMPTY: HistoryFiltersValue = { adminUserId: '', targetUserId: '', dateFrom: '', dateTo: '' };

// fe §5.1/api §2 GET /impersonation/history — HistoryFilters: adminUserId/
// targetUserId/dateFrom/dateTo controls for the endpoint's
// `?adminUserId&targetUserId&dateFrom&dateTo` query. Task 16.2.
describe('HistoryFilters', () => {
  it('renders admin, target, and date range controls at their current value', () => {
    render(<HistoryFilters value={{ adminUserId: 'admin-42', targetUserId: 'trainer-7', dateFrom: '2026-01-01', dateTo: '2026-01-31' }} onChange={jest.fn()} />);

    expect(screen.getByLabelText(/admin user id/i)).toHaveValue('admin-42');
    expect(screen.getByLabelText(/target user id/i)).toHaveValue('trainer-7');
    expect(screen.getByLabelText(/^from$/i)).toHaveValue('2026-01-01');
    expect(screen.getByLabelText(/^to$/i)).toHaveValue('2026-01-31');
  });

  it('calls onChange with the updated adminUserId, keeping other filters', () => {
    const onChange = jest.fn();
    render(<HistoryFilters value={{ ...EMPTY, targetUserId: 'trainer-7' }} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText(/admin user id/i), { target: { value: 'admin-42' } });

    expect(onChange).toHaveBeenCalledWith({ adminUserId: 'admin-42', targetUserId: 'trainer-7', dateFrom: '', dateTo: '' });
  });

  it('calls onChange with the updated targetUserId', () => {
    const onChange = jest.fn();
    render(<HistoryFilters value={EMPTY} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText(/target user id/i), { target: { value: 'trainer-7' } });

    expect(onChange).toHaveBeenCalledWith({ ...EMPTY, targetUserId: 'trainer-7' });
  });

  it('calls onChange with the updated dateFrom/dateTo', () => {
    const onChange = jest.fn();
    render(<HistoryFilters value={EMPTY} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText(/^from$/i), { target: { value: '2026-01-01' } });
    expect(onChange).toHaveBeenCalledWith({ ...EMPTY, dateFrom: '2026-01-01' });

    fireEvent.change(screen.getByLabelText(/^to$/i), { target: { value: '2026-01-31' } });
    expect(onChange).toHaveBeenCalledWith({ ...EMPTY, dateTo: '2026-01-31' });
  });
});
