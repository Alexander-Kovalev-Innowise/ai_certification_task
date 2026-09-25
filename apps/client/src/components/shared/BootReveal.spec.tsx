import { render, screen } from '@testing-library/react';

import { BootRevealItem, BootRevealShell } from './BootReveal';

// fe §1.3/Task 18.5 — the one-time staggered boot reveal (logo → headline →
// form, 60ms stagger, 220ms ease-out) used ONLY on `/login` and
// `/join/[code]` — every authenticated dashboard route renders instantly
// with skeletons instead (Task 18.4), never this.
describe('BootReveal', () => {
  it('renders every child normally (stagger is a timing detail, not a visibility gate)', () => {
    render(
      <BootRevealShell>
        <BootRevealItem>
          <span>logo</span>
        </BootRevealItem>
        <BootRevealItem>
          <h1>headline</h1>
        </BootRevealItem>
        <BootRevealItem>
          <form aria-label="form">form content</form>
        </BootRevealItem>
      </BootRevealShell>,
    );

    expect(screen.getByText('logo')).toBeInTheDocument();
    expect(screen.getByText('headline')).toBeInTheDocument();
    expect(screen.getByLabelText('form')).toBeInTheDocument();
  });

  it('accepts a className on the shell for layout (e.g. max-width) without breaking children', () => {
    render(
      <BootRevealShell className="max-w-md">
        <BootRevealItem>
          <span>content</span>
        </BootRevealItem>
      </BootRevealShell>,
    );

    expect(screen.getByText('content')).toBeInTheDocument();
  });
});
