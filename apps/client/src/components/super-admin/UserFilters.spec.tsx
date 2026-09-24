import { fireEvent, render, screen } from '@testing-library/react';

import type { UserFiltersValue } from './UserFilters';
import { UserFilters } from './UserFilters';

const EMPTY: UserFiltersValue = { search: '', role: '', status: '' };

// fe §4.3 — UserFilters: search/role/status controls for GET /users'
// `?search&role&status` query (api §3). Task 12.3.
describe('UserFilters', () => {
  it('renders search, role, and status controls at their current value', () => {
    render(<UserFilters value={{ search: 'ada', role: 'TRAINER', status: 'ACTIVE' }} onChange={jest.fn()} />);

    expect(screen.getByLabelText(/search/i)).toHaveValue('ada');
    expect(screen.getByLabelText(/role/i)).toHaveValue('TRAINER');
    expect(screen.getByLabelText(/status/i)).toHaveValue('ACTIVE');
  });

  it('calls onChange with the updated search term, keeping other filters', () => {
    const onChange = jest.fn();
    render(<UserFilters value={{ ...EMPTY, role: 'COACH' }} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText(/search/i), { target: { value: 'sam' } });

    expect(onChange).toHaveBeenCalledWith({ search: 'sam', role: 'COACH', status: '' });
  });

  it('calls onChange with the updated role', () => {
    const onChange = jest.fn();
    render(<UserFilters value={EMPTY} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText(/role/i), { target: { value: 'SUPER_ADMIN' } });

    expect(onChange).toHaveBeenCalledWith({ search: '', role: 'SUPER_ADMIN', status: '' });
  });

  it('calls onChange with the updated status', () => {
    const onChange = jest.fn();
    render(<UserFilters value={EMPTY} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText(/status/i), { target: { value: 'INACTIVE' } });

    expect(onChange).toHaveBeenCalledWith({ search: '', role: '', status: 'INACTIVE' });
  });
});
