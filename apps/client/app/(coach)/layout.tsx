'use client';

import type { ReactNode } from 'react';

import { RoleGuard } from '../../src/components/RoleGuard';
import { SkeletonCard } from '../../src/components/shared/Skeleton';
import { useBootstrap } from '../../src/hooks/useBootstrap';
import { BrandingProvider, type BrandingInput } from '../../src/lib/branding/BrandingProvider';

const NAV_LINKS = [
  { href: '/my-times', label: 'My Times' },
  { href: '/profile', label: 'Profile' },
] as const;

function hasCoachBranding(data: unknown): data is { employingTrainer: BrandingInput } {
  return typeof data === 'object' && data !== null && 'employingTrainer' in data;
}

function CoachNav() {
  return (
    <nav aria-label="Coach navigation" className="flex items-center gap-lg border-b border-[var(--border-soft)] bg-[var(--surface-1)] px-lg py-sm">
      {NAV_LINKS.map((link) => (
        <a key={link.href} href={link.href} className="text-body text-[var(--text-primary)] hover:text-[var(--brand-primary)]">
          {link.label}
        </a>
      ))}
    </nav>
  );
}

// fe §3/§4.5 — CoachLayout's inner content: reads GET /me/bootstrap (the
// COACH shape's `employingTrainer` block — BrandingProvider.tsx's own doc
// comment lists `CoachBootstrapDto.employingTrainer` as one of the real
// shapes it's fed) so BrandingProvider applies the coach's employing
// trainer's own accent to every route this layout wraps. Split from
// CoachLayout itself so RoleGuard's "no session at all" branch never
// triggers a bootstrap fetch (same reasoning as TrainerLayoutContent/
// PlayerLayoutContent, RoleGuard returns null before this ever mounts).
function CoachLayoutContent({ children }: { children: ReactNode }) {
  const { data, isLoading } = useBootstrap();

  if (isLoading || !data) {
    return (
      <div className="flex min-h-screen flex-col">
        <CoachNav />
        <main className="flex-1 p-lg" aria-busy="true" aria-label="Loading coach portal">
          <SkeletonCard />
        </main>
      </div>
    );
  }

  const branding = hasCoachBranding(data) ? data.employingTrainer : null;

  return (
    <BrandingProvider branding={branding}>
      <div className="flex min-h-screen flex-col">
        <CoachNav />
        <main className="flex-1">{children}</main>
      </div>
    </BrandingProvider>
  );
}

// fe §3 route map — `(coach)/layout.tsx`: RoleGuard(COACH) + coach nav shell
// (My Times, Profile — the two routes Tasks 15.3-15.4 add) + BrandingProvider
// reading the coach's employing trainer's branding off `GET /me/bootstrap`.
// NOT `/dashboard`, which is the single unified route living outside every
// `(role)` group. Task 15.1.
export default function CoachLayout({ children }: { children: ReactNode }) {
  return (
    <RoleGuard allow="COACH">
      <CoachLayoutContent>{children}</CoachLayoutContent>
    </RoleGuard>
  );
}
