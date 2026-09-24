'use client';

import { createContext, useContext, useMemo, type CSSProperties, type ReactNode } from 'react';

import { darkenColor, hexToRgb, lightenColor } from './color-transform';

// fe §1.2 — platform default (mint), used pre-branding and for the Super
// Admin's own un-impersonated session ("no trainer to derive from", fe §8).
const DEFAULT_PRIMARY_COLOR_HEX = '#6EE7B7';
// fe §8 point 4 — "falling back to the platform default mark
// (default_logo.svg) when null". Served from apps/client/public/ (Next.js
// static-file convention), sourced from Task/designs/default_logo.svg.
const DEFAULT_LOGO_URL = '/default_logo.svg';
// Task/designs/DESIGN_TOKENS.md: "lighten(accentColor, 20%)" /
// "darken(accentColor, 20%)" — the only percentage documented anywhere
// upstream for -soft/-deep.
const SHADE_PERCENT = 20;

export interface BrandingDerivedPalette {
  primaryColorHex: string;
  recommendedTextColor: '#FFFFFF' | '#000000';
  contrastWithWhite: number;
  contrastWithBlack: number;
  meetsAA: boolean;
}

/**
 * Covers every real branding-block shape this provider is fed (fe §8):
 * `TrainerBootstrapDto.branding`, `CoachBootstrapDto.employingTrainer`,
 * `PLAYER_PARENT` bootstrap's `activeContext`/`contexts[]` entries, and the
 * public `GET /share-links/:code` preview all reduce to
 * `{ logoUrl, primaryColorHex }`. Only a fresh `PATCH
 * /trainers/:id/branding` response (`BrandingResponseDto`) additionally
 * carries `derivedPalette`.
 */
export interface BrandingInput {
  logoUrl: string | null;
  primaryColorHex: string | null;
  derivedPalette?: BrandingDerivedPalette | null;
}

export interface ComputedBranding {
  primaryColorHex: string;
  softColorHex: string;
  deepColorHex: string;
  /** "r, g, b" — for rgba()-based glow/shadow usage (fe §1.2). */
  rgb: string;
  logoUrl: string;
  /** Only set when the input carried a `derivedPalette` (i.e., a just-saved branding PATCH response). */
  recommendedTextColor?: '#FFFFFF' | '#000000';
  meetsAA?: boolean;
}

const BrandingContext = createContext<ComputedBranding | null>(null);

/**
 * Reads the resolved branding (already default-and-fallback-applied) that
 * the nearest `BrandingProvider` computed — for a future Logo/NavBar/
 * BrandingLivePreview component to consume without re-implementing the
 * `derivedPalette`-vs-raw-hex/null-branding fallback chain itself.
 */
export function useBranding(): ComputedBranding {
  const ctx = useContext(BrandingContext);
  if (!ctx) {
    throw new Error('useBranding must be used within a BrandingProvider');
  }
  return ctx;
}

/**
 * fe §8 — computes the CSS-ready branding palette from whatever branding
 * block the caller already has (see `BrandingInput`'s doc comment for every
 * real shape this covers). `branding: null` is the Super Admin's own
 * session — no trainer to derive from, platform default renders as-is.
 *
 * IMPORTANT deviation, found during implementation: fe §8 describes this as
 * "if derivedPalette present, use the server-computed shades directly —
 * this is the authoritative palette the server already validated for WCAG
 * contrast". The REAL server type
 * (apps/server/.../wcag-contrast.util.ts's `DerivedPalette` /
 * dto/branding-response.dto.ts's `DerivedPaletteDto`) only ever carries WCAG
 * contrast metadata (`recommendedTextColor`, `contrastWithWhite`,
 * `contrastWithBlack`, `meetsAA`) — it has no `-soft`/`-deep`/`-rgb` shade
 * fields at all, so there is nothing server-computed to "use directly" for
 * those. This function therefore ALWAYS derives -soft/-deep/-rgb
 * client-side via color-transform.ts (Task 10.3), regardless of whether
 * `derivedPalette` is present. When it IS present, its `primaryColorHex` is
 * still treated as the authoritative source hex (the just-saved,
 * server-validated value) and its contrast fields are passed through
 * unchanged for a future ContrastWarningBanner to consume.
 */
export function computeBranding(branding: BrandingInput | null): ComputedBranding {
  const sourceHex = branding?.derivedPalette?.primaryColorHex ?? branding?.primaryColorHex ?? DEFAULT_PRIMARY_COLOR_HEX;
  const { r, g, b } = hexToRgb(sourceHex);

  return {
    primaryColorHex: sourceHex,
    softColorHex: lightenColor(sourceHex, SHADE_PERCENT),
    deepColorHex: darkenColor(sourceHex, SHADE_PERCENT),
    rgb: `${r}, ${g}, ${b}`,
    logoUrl: branding?.logoUrl ?? DEFAULT_LOGO_URL,
    ...(branding?.derivedPalette && {
      recommendedTextColor: branding.derivedPalette.recommendedTextColor,
      meetsAA: branding.derivedPalette.meetsAA,
    }),
  };
}

export interface BrandingProviderProps {
  branding: BrandingInput | null;
  children: ReactNode;
}

/**
 * fe §8 — the single place tenant branding becomes CSS. Never fetches on
 * its own; the caller (a role layout reading its `GET /me/bootstrap`
 * response, or `/join/[code]` reading the public share-link preview) hands
 * it whatever branding block is already on the response it already has.
 *
 * Writes `--brand-primary`/`-soft`/`-deep`/`-rgb` onto a `data-branding`
 * WRAPPER element, deliberately not `:root` — this is what lets
 * `ContextSwitcher` (Phase 14) cross-fade between two trainers' palettes in
 * flight without a flash of wrong-colored content, and what keeps the Super
 * Admin's own chrome on the fixed platform accent even while a trainer's
 * branding is being previewed in a nested panel.
 */
export function BrandingProvider({ branding, children }: BrandingProviderProps) {
  const computed = useMemo(() => computeBranding(branding), [branding]);

  const style: CSSProperties = {
    ['--brand-primary' as string]: computed.primaryColorHex,
    ['--brand-primary-soft' as string]: computed.softColorHex,
    ['--brand-primary-deep' as string]: computed.deepColorHex,
    ['--brand-primary-rgb' as string]: computed.rgb,
  };

  return (
    <div data-branding="" style={style}>
      <BrandingContext.Provider value={computed}>{children}</BrandingContext.Provider>
    </div>
  );
}
