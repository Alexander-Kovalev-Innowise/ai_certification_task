'use client';

import type { ReactNode } from 'react';

import { BrandingProvider, useBranding } from '../../lib/branding/BrandingProvider';

export interface ShareLinkPreviewProps {
  trainerDisplayName: string;
  logoUrl: string | null;
  primaryColorHex: string | null;
  children?: ReactNode;
}

function ShareLinkPreviewContent({ trainerDisplayName, children }: { trainerDisplayName: string; children?: ReactNode }) {
  // fe §4.2 — BrandingProvider's already-default-and-fallback-applied
  // computed palette (Task 10.10), consumed here instead of the raw
  // logoUrl/primaryColorHex props so the platform-default fallback (mint,
  // default_logo.svg) applies identically to an anonymous visitor as it
  // does everywhere else branding renders.
  const branding = useBranding();

  return (
    <div className="flex flex-col items-center gap-md text-center">
      {/* eslint-disable-next-line @next/next/no-img-element -- trainer-supplied remote logo URL, not a static/optimizable local asset */}
      <img
        src={branding.logoUrl}
        alt={trainerDisplayName ? `${trainerDisplayName} logo` : 'Trainer logo'}
        className="h-16 w-16 rounded-full object-cover"
      />
      <h1 className="font-display text-hero-title text-[var(--text-primary)]">Join {trainerDisplayName}</h1>
      {children}
    </div>
  );
}

// fe §4.2 — "BrandingProvider applies this trainer's accent to the join
// page itself, pre-auth" — an anonymous visitor sees the trainer's identity
// before any account exists. Task 11.10 renders the branch-specific form as
// `children`, once those components exist.
export function ShareLinkPreview({ trainerDisplayName, logoUrl, primaryColorHex, children }: ShareLinkPreviewProps) {
  return (
    <BrandingProvider branding={{ logoUrl, primaryColorHex }}>
      <ShareLinkPreviewContent trainerDisplayName={trainerDisplayName}>{children}</ShareLinkPreviewContent>
    </BrandingProvider>
  );
}
