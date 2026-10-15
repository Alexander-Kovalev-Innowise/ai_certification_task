import { render, screen } from '@testing-library/react';

import { RoleCannotJoinNotice } from './RoleCannotJoinNotice';

describe('RoleCannotJoinNotice', () => {
  it('renders a role-appropriate notice', () => {
    render(<RoleCannotJoinNotice />);

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/can't join as a participant/)).toBeInTheDocument();
  });
});
