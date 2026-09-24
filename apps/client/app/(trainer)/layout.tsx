'use client';

import type { ReactNode } from 'react';

import { RoleGuard } from '../../src/components/RoleGuard';
import { SkeletonCard } from '../../src/components/shared/Skeleton';
import { useBootstrap } from '../../src/hooks/useBootstrap';
import { BrandingProvider, type BrandingInput } from '../../src/lib/branding/BrandingProvider';

const NAV_LINKS = [
  { href: '/coaches', label: 'Coaches' },
  { href: '/players', label: 'Players' },
  { href: '/share-links', label: 'Share Links' },
] as const;

function hasTrainerBranding(data: unknown): data is { branding: BrandingInput } {
  return typeof data === 'object' && data !== null && 'branding' in data;
}

function TrainerNav() {
  return (
    <nav
      aria-label="Trainer navigation"
      className="flex items-center gap-lg border-b border-[var(--border-soft)] bg-[var(--surface-1)] px-lg py-sm"
    >
      {NAV_LINKS.map((link) => (
        <a key={link.href} href={link.href} className="text-body text-[var(--text-primary)] hover:text-[var(--brand-primary)]">
          {link.label}
        </a>
      ))}
    </nav>
  );
}

// fe §3/§4.4 — TrainerLayout's inner content: reads GET /me/bootstrap (the
// TRAINER shape's `branding` block) so BrandingProvider can apply this
// trainer's own accent to every route this layout wraps, not just the
// branding-preview leaf a later phase adds. Split from TrainerLayout itself
// so RoleGuard's "no session at all" branch never triggers a bootstrap fetch
// (RoleGuard returns null before this ever mounts).
function TrainerLayoutContent({ children }: { children: ReactNode }) {
  const { data, isLoading } = useBootstrap();

  if (isLoading || !data) {
    return (
      <div className="flex min-h-screen flex-col">
        <TrainerNav />
        <main className="flex-1 p-lg" aria-busy="true" aria-label="Loading trainer portal">
          <SkeletonCard />
        </main>
      </div>
    );
  }

  const branding = hasTrainerBranding(data) ? data.branding : null;

  return (
    <BrandingProvider branding={branding}>
      <div className="flex min-h-screen flex-col">
        <TrainerNav />
        <main className="flex-1">{children}</main>
      </div>
    </BrandingProvider>
  );
}

// fe §3 route map — `(trainer)/layout.tsx`: RoleGuard(TRAINER) + trainer nav
// shell (Coaches, Share Links — the two routes this phase adds; `/players`
// and `/branding` are later phases per the plan's file lists) +
// BrandingProvider reading the caller's own `trainerProfile`/`branding` off
// `GET /me/bootstrap`. NOT `/dashboard`, which is the single unified route
// living outside every `(role)` group. Task 13.1.
export default function TrainerLayout({ children }: { children: ReactNode }) {
  return (
    <RoleGuard allow="TRAINER">
      <TrainerLayoutContent>{children}</TrainerLayoutContent>
    </RoleGuard>
  );
}
