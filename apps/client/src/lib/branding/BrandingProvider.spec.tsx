import { render, screen } from '@testing-library/react';

import { BrandingProvider, useBranding, type BrandingInput } from './BrandingProvider';
import { darkenColor, lightenColor } from './color-transform';

function Probe() {
  const branding = useBranding();
  return (
    <dl>
      <dt>primary</dt>
      <dd>{branding.primaryColorHex}</dd>
      <dt>soft</dt>
      <dd>{branding.softColorHex}</dd>
      <dt>deep</dt>
      <dd>{branding.deepColorHex}</dd>
      <dt>rgb</dt>
      <dd>{branding.rgb}</dd>
      <dt>logo</dt>
      <dd>{branding.logoUrl}</dd>
      <dt>meetsAA</dt>
      <dd>{String(branding.meetsAA)}</dd>
    </dl>
  );
}

describe('BrandingProvider', () => {
  afterEach(() => {
    document.documentElement.style.cssText = '';
  });

  it('falls back to the platform default (mint) and default logo when branding is null (Super Admin, no trainer)', () => {
    render(
      <BrandingProvider branding={null}>
        <Probe />
      </BrandingProvider>,
    );

    expect(screen.getByText('#6EE7B7')).toBeInTheDocument();
    expect(screen.getByText('/default_logo.svg')).toBeInTheDocument();
  });

  it('computes -soft/-deep/-rgb client-side from a raw primaryColorHex-only input (no derivedPalette)', () => {
    const branding: BrandingInput = { logoUrl: 'https://cdn.example.com/logo.png', primaryColorHex: '#6EE7B7' };

    render(
      <BrandingProvider branding={branding}>
        <Probe />
      </BrandingProvider>,
    );

    // Same 20% formula color-transform.spec.ts already verifies in isolation
    // — asserted here too so a regression in either file shows up as a
    // BrandingProvider test failure, not just a color-transform one.
    expect(screen.getByText('#6EE7B7')).toBeInTheDocument();
    expect(screen.getByText(lightenColor('#6EE7B7', 20))).toBeInTheDocument();
    expect(screen.getByText(darkenColor('#6EE7B7', 20))).toBeInTheDocument();
    expect(screen.getByText('110, 231, 183')).toBeInTheDocument();
    expect(screen.getByText('https://cdn.example.com/logo.png')).toBeInTheDocument();
  });

  it('uses a server-provided derivedPalette.primaryColorHex as-is and passes through its contrast metadata unchanged', () => {
    const branding: BrandingInput = {
      logoUrl: null,
      primaryColorHex: '#111111', // stale bootstrap-cached value — derivedPalette.primaryColorHex must win
      derivedPalette: {
        primaryColorHex: '#FF00AA',
        recommendedTextColor: '#FFFFFF',
        contrastWithWhite: 3.2,
        contrastWithBlack: 6.1,
        meetsAA: false,
      },
    };

    render(
      <BrandingProvider branding={branding}>
        <Probe />
      </BrandingProvider>,
    );

    expect(screen.getByText('#FF00AA')).toBeInTheDocument();
    expect(screen.getByText('false')).toBeInTheDocument(); // meetsAA passed through as-is
    // -soft/-deep are still derived client-side from that hex — the server
    // never computes them (see BrandingProvider.tsx's doc comment).
    expect(screen.getByText(lightenColor('#FF00AA', 20))).toBeInTheDocument();
    expect(screen.getByText(darkenColor('#FF00AA', 20))).toBeInTheDocument();
  });

  it('writes the CSS custom properties onto the data-branding wrapper element, never onto document.documentElement', () => {
    const branding: BrandingInput = { logoUrl: null, primaryColorHex: '#123456' };

    const { container } = render(
      <BrandingProvider branding={branding}>
        <span>child</span>
      </BrandingProvider>,
    );

    const wrapper = container.querySelector('[data-branding]') as HTMLElement;
    expect(wrapper).not.toBeNull();
    expect(wrapper.style.getPropertyValue('--brand-primary')).toBe('#123456');
    expect(wrapper.style.getPropertyValue('--brand-primary-soft')).toBe(lightenColor('#123456', 20));
    expect(wrapper.style.getPropertyValue('--brand-primary-deep')).toBe(darkenColor('#123456', 20));
    expect(wrapper.style.getPropertyValue('--brand-primary-rgb')).not.toBe('');

    expect(document.documentElement.style.getPropertyValue('--brand-primary')).toBe('');
  });

  it('throws when useBranding is called outside a BrandingProvider', () => {
    // Suppress React's expected error-boundary console.error noise for this one assertion.
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    function Broken() {
      useBranding();
      return null;
    }
    expect(() => render(<Broken />)).toThrow('useBranding must be used within a BrandingProvider');
    spy.mockRestore();
  });
});
