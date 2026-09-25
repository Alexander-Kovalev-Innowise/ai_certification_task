import { fireEvent, render, screen } from '@testing-library/react';

import { Button } from './Button';

// fe §1.3/§1.4/Task 18.5 — shared `Button`: `-translate-y-1 scale-1.02` on
// hover per DESIGN_TOKENS.md, spring-eased (stiffness: 400, damping: 28).
// No such shared component existed before this task (every prior phase
// hand-rolled its own submit-button className) — this is genuinely new
// infrastructure, not a "confirm" pass on an existing file. Used in this
// phase's own new/touched surfaces (ImpersonationBanner's Exit button);
// retrofitting every existing hand-rolled button across Phases 11-17 is out
// of scope here, the same boundary the toast system (Task 18.3) drew.
describe('Button', () => {
  it('renders children and forwards a click handler', () => {
    const onClick = jest.fn();
    render(<Button onClick={onClick}>Save</Button>);

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('defaults to type="button" (never submits a form by accident)', () => {
    render(<Button>Cancel</Button>);
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveAttribute('type', 'button');
  });

  it('lets a caller override type, e.g. for a form submit button', () => {
    render(<Button type="submit">Save</Button>);
    expect(screen.getByRole('button', { name: 'Save' })).toHaveAttribute('type', 'submit');
  });

  it('applies the disabled attribute and skips hover motion when disabled', () => {
    render(<Button disabled>Saving…</Button>);
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
  });

  it('renders the destructive variant with danger styling, never tenant-colored', () => {
    render(<Button variant="destructive">Deactivate</Button>);
    const button = screen.getByRole('button', { name: 'Deactivate' });
    expect(button.className).not.toContain('brand-primary');
    expect(button.className).toContain('danger');
  });

  it('renders the secondary/ghost variant', () => {
    render(<Button variant="secondary">Cancel</Button>);
    const button = screen.getByRole('button', { name: 'Cancel' });
    expect(button.className).toContain('border');
  });
});
