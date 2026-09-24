'use client';

import type { ReactNode } from 'react';

import { ContextSwitcher, type ContextEntry } from '../../src/components/player/ContextSwitcher';
import { RoleGuard } from '../../src/components/RoleGuard';
import { SkeletonCard } from '../../src/components/shared/Skeleton';
import { useBootstrap } from '../../src/hooks/useBootstrap';
import { BrandingProvider, type BrandingInput } from '../../src/lib/branding/BrandingProvider';
import type { AccountType } from '../../src/types/auth';

const NAV_LINKS = [
  { href: '/profiles', label: 'Profiles' },
  { href: '/approvals', label: 'Approvals' },
] as const;

interface PlayerParentBootstrapShape {
  accountType: AccountType;
  contexts: ContextEntry[];
  activeContext: ContextEntry | null;
  pendingApprovalsCount?: number;
}

function hasPlayerParentShape(data: unknown): data is PlayerParentBootstrapShape {
  return (
    typeof data === 'object' &&
    data !== null &&
    'accountType' in data &&
    'contexts' in data &&
    Array.isArray((data as { contexts?: unknown }).contexts)
  );
}

function PlayerNav() {
  return (
    <nav
      aria-label="Player/Parent navigation"
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

// fe §3/§4.6/§5.2 — PlayerLayout's inner content: reads GET /me/bootstrap
// (the PLAYER_PARENT shape's `contexts`/`activeContext`) so ContextSwitcher
// never invents context data client-side, and so BrandingProvider applies
// the active context's trainer accent. Split from PlayerLayout itself for
// the same reason TrainerLayoutContent is split from TrainerLayout (Task
// 13.1): RoleGuard's "no session at all" branch never triggers a bootstrap
// fetch, since RoleGuard returns null before this ever mounts.
function PlayerLayoutContent({ children }: { children: ReactNode }) {
  const { data, isLoading } = useBootstrap();

  if (isLoading || !data || !hasPlayerParentShape(data)) {
    return (
      <div className="flex min-h-screen flex-col">
        <PlayerNav />
        <main className="flex-1 p-lg" aria-busy="true" aria-label="Loading player portal">
          <SkeletonCard />
        </main>
      </div>
    );
  }

  const { accountType, contexts, activeContext } = data;
  const branding: BrandingInput | null = activeContext ? { logoUrl: activeContext.logoUrl, primaryColorHex: activeContext.primaryColorHex } : null;

  return (
    <BrandingProvider branding={branding}>
      <div className="flex min-h-screen flex-col">
        <PlayerNav />
        <ContextSwitcher accountType={accountType} contexts={contexts} activeContext={activeContext} />
        <main className="flex-1">{children}</main>
      </div>
    </BrandingProvider>
  );
}

// fe §3 route map — `(player)/layout.tsx`: RoleGuard(PLAYER_PARENT), mounts
// ContextSwitcher (§5.2) so its state survives client-side navigation across
// every player/parent route this layout wraps (Next.js App Router preserves
// layout component state across route transitions within the same layout
// tree — this is why ContextSwitcher is layout-level, not per-page). NOT
// `/dashboard`, which is the single unified route living outside every
// `(role)` group. Task 14.1.
export default function PlayerLayout({ children }: { children: ReactNode }) {
  return (
    <RoleGuard allow="PLAYER_PARENT">
      <PlayerLayoutContent>{children}</PlayerLayoutContent>
    </RoleGuard>
  );
}
