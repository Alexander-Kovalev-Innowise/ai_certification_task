import { computeDerivedPalette } from './wcag-contrast.util';

// Task 8.1 (api §4.1 "PATCH /trainers/:id/branding", OQ-7). Pure-function
// coverage for the WCAG math, isolated from PortalBrandingService's DB/outbox
// side effects (those are covered by portal-branding.service.spec.ts).
describe('computeDerivedPalette (Task 8.1)', () => {
  it('#767676 meets AA (4.5:1) against BOTH white and black text -> no warning', () => {
    // #767676 is the well-known "sweet spot" gray whose luminance sits in the
    // narrow band where both white-on-it and black-on-it clear 4.5:1 — the
    // canonical "passes AA either way" example in WCAG contrast discussions.
    const { palette, contrastWarning } = computeDerivedPalette('#767676');

    expect(palette.meetsAA).toBe(true);
    expect(palette.contrastWithWhite).toBeGreaterThanOrEqual(4.5);
    expect(palette.contrastWithBlack).toBeGreaterThanOrEqual(4.5);
    expect(contrastWarning).toBeUndefined();
  });

  it('#FF0000 (red) fails AA against white text (4.0:1 < 4.5:1) -> returns a warning', () => {
    const { palette, contrastWarning } = computeDerivedPalette('#FF0000');

    expect(palette.meetsAA).toBe(false);
    expect(palette.contrastWithWhite).toBeLessThan(4.5);
    expect(contrastWarning).toContain('#FF0000');
  });

  it('#000000 (black) fails AA against black text (1:1) even though it is perfect against white -> still warns', () => {
    const { palette, contrastWarning } = computeDerivedPalette('#000000');

    expect(palette.contrastWithWhite).toBeCloseTo(21, 0);
    expect(palette.contrastWithBlack).toBeCloseTo(1, 0);
    expect(palette.meetsAA).toBe(false);
    expect(contrastWarning).toBeDefined();
  });

  it('recommends the higher-contrast text color', () => {
    const dark = computeDerivedPalette('#0D47A1');
    expect(dark.palette.recommendedTextColor).toBe('#FFFFFF');

    const light = computeDerivedPalette('#FFFACD');
    expect(light.palette.recommendedTextColor).toBe('#000000');
  });

  it('preserves the input hex on the palette', () => {
    const { palette } = computeDerivedPalette('#767676');
    expect(palette.primaryColorHex).toBe('#767676');
  });
});
