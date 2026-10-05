'use client';

import type { ReactNode } from 'react';

import { RoleGuard } from '../../src/components/RoleGuard';
import { SkeletonCard } from '../../src/components/shared/Skeleton';
import { useBootstrap } from '../../src/hooks/useBootstrap';

// The nav shell, ContextSwitcher and BrandingProvider live in the root-level
// <AuthenticatedShell> (src/components/shell/AuthenticatedShell.tsx) so they
// persist across navigation; this layout only gates the role and holds the
// content area on a skeleton until GET /me/bootstrap resolves. Split from
// PlayerLayout so RoleGuard's "no session" branch never reaches this hook.
function PlayerLayoutContent({ children }: { children: ReactNode }) {
  const { isLoading } = useBootstrap();

  if (isLoading) {
    return (
      <div className="p-lg" aria-busy="true" aria-label="Loading player portal">
        <SkeletonCard />
      </div>
    );
  }

  return <>{children}</>;
}

// fe §3 route map — `(player)/layout.tsx`: RoleGuard(PLAYER_PARENT). NOT
// `/dashboard`, which is the single unified route living outside every
// `(role)` group. Task 14.1.
export default function PlayerLayout({ children }: { children: ReactNode }) {
  return (
    <RoleGuard allow="PLAYER_PARENT">
      <PlayerLayoutContent>{children}</PlayerLayoutContent>
    </RoleGuard>
  );
}
