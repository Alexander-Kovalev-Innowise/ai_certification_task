import { render, screen } from '@testing-library/react';

import { ChangePasswordLink } from './ChangePasswordLink';

// fe §4.7/Task 18.1 — `/account/profile`'s link into the voluntary
// change-password path. `ChangePasswordForm` (Task 11.6) already reads
// `user.mustChangePassword` itself to decide whether to show the
// `currentPassword` field, so this component only needs to point at the
// shared `/change-password` route — no mode prop to thread through.
describe('ChangePasswordLink', () => {
  it('renders a link to /change-password', () => {
    render(<ChangePasswordLink />);

    const link = screen.getByRole('link', { name: /change password/i });
    expect(link).toHaveAttribute('href', '/change-password');
  });
});
