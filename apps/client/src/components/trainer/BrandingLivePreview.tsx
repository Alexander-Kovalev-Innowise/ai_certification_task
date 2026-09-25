'use client';

import { computeBranding } from '../../lib/branding/BrandingProvider';

// fe §8 "`/trainer/branding` settings form specifics" — "BrandingLivePreview
// (a miniature rendering of the nav bar + a primary button, using the
// in-progress hex before save)". Task 17.1.
//
// Deliberately reuses BrandingProvider's own `computeBranding()` (Phase 10)
// rather than re-deriving -soft/-deep/-rgb shades a third way — this is the
// exact "display-only recomputation" fe §8 point 2 describes for a
// bootstrap-shaped input (no `derivedPalette`, since nothing has been saved
// yet). It never writes anything back; it's purely a local preview of what
// the in-progress hex would look like.
const HEX_PATTERN = /^#[0-9A-Fa-f]{6}$/;

export interface BrandingLivePreviewProps {
  primaryColorHex: string;
  logoUrl: string | null;
}

export function BrandingLivePreview({ primaryColorHex, logoUrl }: BrandingLivePreviewProps) {
  const sourceHex = HEX_PATTERN.test(primaryColorHex) ? primaryColorHex : null;
  const branding = computeBranding({ logoUrl, primaryColorHex: sourceHex });

  return (
    <div
      data-testid="branding-live-preview"
      className="overflow-hidden rounded-md border border-[var(--border-soft)]"
    >
      <nav
        aria-label="Branding preview navigation"
        className="flex items-center gap-sm p-sm"
        style={{ backgroundColor: branding.deepColorHex }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- tiny live preview swatch, not a real app route */}
        <img src={branding.logoUrl} alt="Logo preview" className="h-6 w-6 rounded-sm object-contain" />
        <span className="text-caption font-semibold text-[#0D0D0D]">Your portal</span>
      </nav>
      <div className="flex justify-center p-md">
        <button
          type="button"
          disabled
          style={{ backgroundColor: branding.primaryColorHex }}
          className="rounded-sm p-sm text-body font-semibold text-[#0D0D0D] shadow-button-primary"
        >
          Preview button
        </button>
      </div>
    </div>
  );
}
