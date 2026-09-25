import { render, screen } from '@testing-library/react';

import { BrandingLivePreview } from './BrandingLivePreview';

// fe §8 — "a miniature rendering of the nav bar + a primary button, using
// the in-progress hex before save". Task 17.1. Reuses BrandingProvider's own
// `computeBranding()` for the -soft/-deep/-rgb shades (fe §8 point 2 —
// display-only recomputation, never authoritative) so this preview can never
// visually disagree with the real BrandingProvider's math.
describe('BrandingLivePreview', () => {
  it('renders a nav bar and a primary button styled with the in-progress hex', () => {
    render(<BrandingLivePreview primaryColorHex="#123ABC" logoUrl={null} />);

    const preview = screen.getByTestId('branding-live-preview');
    expect(preview).toBeInTheDocument();

    const button = screen.getByRole('button', { name: /preview/i });
    expect(button).toHaveStyle({ backgroundColor: '#123ABC' });
  });

  it('falls back to the platform default mark when logoUrl is null', () => {
    render(<BrandingLivePreview primaryColorHex="#123ABC" logoUrl={null} />);

    const logo = screen.getByRole('img', { name: /logo/i });
    expect(logo).toHaveAttribute('src', '/default_logo.svg');
  });

  it('renders the provided logoUrl when present', () => {
    render(<BrandingLivePreview primaryColorHex="#123ABC" logoUrl="https://cdn.example.com/logo.png" />);

    const logo = screen.getByRole('img', { name: /logo/i });
    expect(logo).toHaveAttribute('src', 'https://cdn.example.com/logo.png');
  });

  it('ignores an invalid in-progress hex and falls back to the platform default for the preview color', () => {
    render(<BrandingLivePreview primaryColorHex="not-a-hex" logoUrl={null} />);

    const button = screen.getByRole('button', { name: /preview/i });
    expect(button).toHaveStyle({ backgroundColor: '#6EE7B7' });
  });
});
