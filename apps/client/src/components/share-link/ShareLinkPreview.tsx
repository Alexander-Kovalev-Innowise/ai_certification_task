'use client';

import type { ReactNode } from 'react';

import { BrandingProvider, useBranding } from '../../lib/branding/BrandingProvider';
import { BootRevealItem, BootRevealShell } from '../shared/BootReveal';

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
    // fe §1.3/Task 18.5 — `/join/[code]`'s other boot-reveal site (logo ->
    // headline -> form, 60ms stagger, 220ms ease-out): this stage-2 "ready"
    // render already has exactly that logo/headline/children(form) shape,
    // so it's wrapped in place rather than duplicating it. The 'pending'/
    // 'invalid'/'resolved' stages in ShareLinkDispatcher.tsx are
    // deliberately NOT wrapped — the reveal is for the one moment a real
    // form appears, not every state transition in that component's own
    // machine.
    <BootRevealShell className="flex flex-col items-center gap-md text-center">
      <BootRevealItem>
        {/* eslint-disable-next-line @next/next/no-img-element -- trainer-supplied remote logo URL, not a static/optimizable local asset */}
        <img
          src={branding.logoUrl}
          alt={trainerDisplayName ? `${trainerDisplayName} logo` : 'Trainer logo'}
          className="h-16 w-16 rounded-full object-cover"
        />
      </BootRevealItem>
      <BootRevealItem>
        <h1 className="font-display text-hero-title text-[var(--text-primary)]">Join {trainerDisplayName}</h1>
      </BootRevealItem>
      <BootRevealItem>{children}</BootRevealItem>
    </BootRevealShell>
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
