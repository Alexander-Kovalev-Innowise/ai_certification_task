import { fireEvent, render, screen } from '@testing-library/react';

import { RevokeConfirmPopover } from './RevokeConfirmPopover';

// fe §4.4/§9.4 — RevokeConfirmPopover: a small inline confirm affordance
// (not a full blocking modal) for `DELETE /share-links/:id` — revoke is
// low-stakes/easily-reversible-in-effect, so the actual optimistic
// row-fade/rollback lives at the `/share-links` page's mutation, not here.
// This component only owns the open/close + confirm/cancel interaction.
// Task 13.3.
describe('RevokeConfirmPopover', () => {
  it('shows a "Revoke" trigger button and no popover initially', () => {
    render(<RevokeConfirmPopover onConfirm={jest.fn()} />);

    expect(screen.getByRole('button', { name: /^revoke$/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /yes, revoke/i })).not.toBeInTheDocument();
  });

  it('opens the confirm popover when the trigger is clicked', () => {
    render(<RevokeConfirmPopover onConfirm={jest.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /^revoke$/i }));

    expect(screen.getByText(/revoke this share link/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /yes, revoke/i })).toBeInTheDocument();
  });

  it('calls onConfirm and closes when confirmed', () => {
    const onConfirm = jest.fn();
    render(<RevokeConfirmPopover onConfirm={onConfirm} />);

    fireEvent.click(screen.getByRole('button', { name: /^revoke$/i }));
    fireEvent.click(screen.getByRole('button', { name: /yes, revoke/i }));

    expect(onConfirm).toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /yes, revoke/i })).not.toBeInTheDocument();
  });

  it('closes without calling onConfirm when cancelled', () => {
    const onConfirm = jest.fn();
    render(<RevokeConfirmPopover onConfirm={onConfirm} />);

    fireEvent.click(screen.getByRole('button', { name: /^revoke$/i }));
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /yes, revoke/i })).not.toBeInTheDocument();
  });

  it('disables the trigger when disabled is true', () => {
    render(<RevokeConfirmPopover onConfirm={jest.fn()} disabled />);

    expect(screen.getByRole('button', { name: /^revoke$/i })).toBeDisabled();
  });
});
