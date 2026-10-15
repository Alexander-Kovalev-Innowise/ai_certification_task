import { darkenColor, hexToRgb, lightenColor } from './color-transform';

describe('hexToRgb', () => {
  // Cross-checked against the platform-default mint already hardcoded in
  // globals.css (`--brand-primary: #6EE7B7` / `--brand-primary-rgb: 110, 231, 183`)
  // and against apps/server/src/modules/trainers/wcag-contrast.util.ts's own
  // hexToRgb (same parseInt-per-2-hex-digit-slice algorithm) — this function
  // must never numerically diverge from the server's.
  it('decodes a 6-digit hex string with a leading #', () => {
    expect(hexToRgb('#6EE7B7')).toEqual({ r: 110, g: 231, b: 183 });
  });

  it('decodes a 6-digit hex string without a leading #', () => {
    expect(hexToRgb('6EE7B7')).toEqual({ r: 110, g: 231, b: 183 });
  });

  it('decodes pure black and pure white', () => {
    expect(hexToRgb('#000000')).toEqual({ r: 0, g: 0, b: 0 });
    expect(hexToRgb('#FFFFFF')).toEqual({ r: 255, g: 255, b: 255 });
  });

  it('is case-insensitive', () => {
    expect(hexToRgb('#6ee7b7')).toEqual({ r: 110, g: 231, b: 183 });
  });
});

describe('lightenColor', () => {
  // lightenColor(hex, percent) mixes each RGB channel toward 255 (white) by
  // `percent`% — channel + (255 - channel) * percent/100, rounded, clamped.
  it('mixes pure black toward white by the given percent', () => {
    // 0 + (255 - 0) * 0.20 = 51 = 0x33
    expect(lightenColor('#000000', 20)).toBe('#333333');
  });

  it('leaves white unchanged (already at the ceiling)', () => {
    expect(lightenColor('#FFFFFF', 20)).toBe('#FFFFFF');
  });

  it('lightens the platform-default brand color by 20% (the --brand-primary-soft formula)', () => {
    // r: 110 + (255-110)*0.20 = 139 = 0x8B
    // g: 231 + (255-231)*0.20 = 235.8 -> round 236 = 0xEC
    // b: 183 + (255-183)*0.20 = 197.4 -> round 197 = 0xC5
    expect(lightenColor('#6EE7B7', 20)).toBe('#8BECC5');
  });

  it('returns the original color unchanged at 0%', () => {
    expect(lightenColor('#123456', 0)).toBe('#123456');
  });
});

describe('darkenColor', () => {
  // darkenColor(hex, percent) mixes each RGB channel toward 0 (black) by
  // `percent`% — channel * (1 - percent/100), rounded, clamped.
  it('mixes pure white toward black by the given percent', () => {
    // 255 * (1 - 0.20) = 204 = 0xCC
    expect(darkenColor('#FFFFFF', 20)).toBe('#CCCCCC');
  });

  it('leaves black unchanged (already at the floor)', () => {
    expect(darkenColor('#000000', 20)).toBe('#000000');
  });

  it('darkens the platform-default brand color by 20% (the --brand-primary-deep formula)', () => {
    // r: 110 * 0.80 = 88 = 0x58
    // g: 231 * 0.80 = 184.8 -> round 185 = 0xB9
    // b: 183 * 0.80 = 146.4 -> round 146 = 0x92
    expect(darkenColor('#6EE7B7', 20)).toBe('#58B992');
  });

  it('returns the original color unchanged at 0%', () => {
    expect(darkenColor('#123456', 0)).toBe('#123456');
  });
});
