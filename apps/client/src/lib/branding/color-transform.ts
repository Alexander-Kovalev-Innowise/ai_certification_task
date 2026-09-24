// fe §1.2/§8, Task 10.3. Pure, dependency-free color math for the
// BrandingProvider fallback path (Task 10.10) — computing `--brand-primary-
// soft`/`-deep`/`-rgb` client-side when a bootstrap/preview response only
// carries a raw `primaryColorHex` and no pre-shaded palette.
//
// IMPORTANT (found during implementation, flagged for sign-off): the plan
// text for this task says these functions "must produce numerically
// identical output to whatever the server's derivedPalette computation
// uses". The server's actual implementation
// (apps/server/src/modules/trainers/wcag-contrast.util.ts,
// `computeDerivedPalette`) does NOT compute lighten/darken shades at all —
// `DerivedPalette`/`DerivedPaletteDto` only carry WCAG contrast metadata
// (`recommendedTextColor`, `contrastWithWhite`, `contrastWithBlack`,
// `meetsAA`). There is no server-side `-soft`/`-deep`/`-rgb` computation to
// match. `hexToRgb` below mirrors the server's own hexToRgb helper exactly
// (same parseInt-per-2-hex-digit-slice algorithm), which is the one piece
// that *does* have a server equivalent; `lightenColor`/`darkenColor` use the
// standard "mix each channel toward white/black by percent" formula named in
// Task/designs/DESIGN_TOKENS.md ("lighten(accentColor, 20%)" /
// "darken(accentColor, 20%)") since no other formula is documented anywhere
// upstream. This means BrandingProvider (Task 10.10) must always compute
// -soft/-deep/-rgb client-side via this module, regardless of whether
// `derivedPalette` is present on the response — see that task's notes.

export interface RgbColor {
  r: number;
  g: number;
  b: number;
}

/** Mirrors apps/server/.../wcag-contrast.util.ts's hexToRgb exactly. */
export function hexToRgb(hex: string): RgbColor {
  const value = hex.replace('#', '');
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16),
  };
}

function clampChannel(value: number): number {
  return Math.min(255, Math.max(0, Math.round(value)));
}

function channelToHex(channel: number): string {
  return clampChannel(channel).toString(16).toUpperCase().padStart(2, '0');
}

function rgbToHex({ r, g, b }: RgbColor): string {
  return `#${channelToHex(r)}${channelToHex(g)}${channelToHex(b)}`;
}

/** Mixes each RGB channel of `hex` toward white (255) by `percent`%. */
export function lightenColor(hex: string, percent: number): string {
  const { r, g, b } = hexToRgb(hex);
  const mix = (channel: number) => channel + (255 - channel) * (percent / 100);
  return rgbToHex({ r: mix(r), g: mix(g), b: mix(b) });
}

/** Mixes each RGB channel of `hex` toward black (0) by `percent`%. */
export function darkenColor(hex: string, percent: number): string {
  const { r, g, b } = hexToRgb(hex);
  const mix = (channel: number) => channel * (1 - percent / 100);
  return rgbToHex({ r: mix(r), g: mix(g), b: mix(b) });
}
