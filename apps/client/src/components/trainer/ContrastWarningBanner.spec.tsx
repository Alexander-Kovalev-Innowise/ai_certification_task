import { fireEvent, render, screen } from '@testing-library/react';

import { ContrastWarningBanner } from './ContrastWarningBanner';

// fe §8 — "On PATCH response, `contrastWarning?: string`... renders as a
// dismissible, non-blocking ContrastWarningBanner directly under the picker
// — save has already succeeded by the time this banner can appear; it is
// advisory... not a gate." Task 17.2.
describe('ContrastWarningBanner', () => {
  it('renders the server-provided contrast warning message', () => {
    render(<ContrastWarningBanner message="This color may be hard to read for some users." onDismiss={jest.fn()} />);

    expect(screen.getByText('This color may be hard to read for some users.')).toBeInTheDocument();
  });

  it('is announced non-intrusively (status, not alert) since the save already succeeded', () => {
    render(<ContrastWarningBanner message="warn" onDismiss={jest.fn()} />);

    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('calls onDismiss when the dismiss control is clicked', () => {
    const onDismiss = jest.fn();
    render(<ContrastWarningBanner message="warn" onDismiss={onDismiss} />);

    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
