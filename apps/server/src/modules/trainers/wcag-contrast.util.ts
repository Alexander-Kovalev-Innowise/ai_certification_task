// Task 8.1 (api §4.1 "PATCH /trainers/:id/branding", OQ-7). Pure WCAG 2.x
// relative-luminance/contrast-ratio math (per the W3C formula), kept in its
// own file so it can be unit tested in isolation from PortalBrandingService's
// DB/outbox side effects. AA_CONTRAST_THRESHOLD (4.5:1) is the "normal text"
// AA threshold — the spec says "fails AA against white/black text" without
// specifying large-text vs normal-text, and normal-text is the stricter/safer
// default for a logo/brand color that may back arbitrary UI text.
const AA_CONTRAST_THRESHOLD = 4.5;

export interface DerivedPalette {
  primaryColorHex: string;
  recommendedTextColor: '#FFFFFF' | '#000000';
  contrastWithWhite: number;
  contrastWithBlack: number;
  meetsAA: boolean;
}

export interface ComputedPaletteResult {
  palette: DerivedPalette;
  contrastWarning?: string;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const value = hex.replace('#', '');
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16),
  };
}

// W3C relative luminance: https://www.w3.org/TR/WCAG21/#dfn-relative-luminance
function linearize(channel: number): number {
  const s = channel / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance({ r, g, b }: { r: number; g: number; b: number }): number {
  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
}

function contrastRatio(luminanceA: number, luminanceB: number): number {
  const lighter = Math.max(luminanceA, luminanceB);
  const darker = Math.min(luminanceA, luminanceB);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Computes the WCAG-derived accessible palette for a hex color (Task 8.1's
 * `derivedPaletteJson`), plus a non-blocking warning string when the color
 * fails AA (4.5:1) against EITHER white or black text.
 *
 * `meetsAA` requires BOTH contrastWithWhite >= 4.5 AND contrastWithBlack >=
 * 4.5 — not "at least one passes". A brand color isn't only ever paired with
 * whichever of black/white contrasts best against it (that combination
 * always clears AA for literally any hex — WCAG's black/white contrast
 * curves cross above 4.5:1 for every possible luminance, so a "best of
 * either" rule could never fire this warning, defeating its purpose); it is
 * also used standalone as an accent against a fixed white (light-mode) or
 * black (dark-mode) surface, per FR-071's portal-branding use case, so both
 * contexts must independently clear AA. #767676 is the well-known real-world
 * example: the one gray whose luminance sits in the narrow band where both
 * do.
 */
export function computeDerivedPalette(hex: string): ComputedPaletteResult {
  const luminance = relativeLuminance(hexToRgb(hex));
  const contrastWithWhite = contrastRatio(luminance, 1);
  const contrastWithBlack = contrastRatio(luminance, 0);
  const meetsAA = contrastWithWhite >= AA_CONTRAST_THRESHOLD && contrastWithBlack >= AA_CONTRAST_THRESHOLD;

  const palette: DerivedPalette = {
    primaryColorHex: hex,
    recommendedTextColor: contrastWithWhite >= contrastWithBlack ? '#FFFFFF' : '#000000',
    contrastWithWhite: Math.round(contrastWithWhite * 100) / 100,
    contrastWithBlack: Math.round(contrastWithBlack * 100) / 100,
    meetsAA,
  };

  return {
    palette,
    contrastWarning: meetsAA
      ? undefined
      : `${hex} does not meet WCAG AA contrast (4.5:1) against white or black text`,
  };
}
