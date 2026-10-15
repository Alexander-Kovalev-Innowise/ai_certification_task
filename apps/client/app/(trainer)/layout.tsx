'use client';

import type { ReactNode } from 'react';

import { RoleGuard } from '../../src/components/RoleGuard';
import { SkeletonCard } from '../../src/components/shared/Skeleton';
import { useBootstrap } from '../../src/hooks/useBootstrap';

// The nav shell and BrandingProvider live in the root-level
// <AuthenticatedShell> (src/components/shell/AuthenticatedShell.tsx) so they
// persist across navigation; this layout only gates the role and holds the
// content area on a skeleton until GET /me/bootstrap resolves. Split from
// TrainerLayout so RoleGuard's "no session" branch never reaches this hook.
function TrainerLayoutContent({ children }: { children: ReactNode }) {
  const { isLoading } = useBootstrap();

  if (isLoading) {
    return (
      <div className="p-lg" aria-busy="true" aria-label="Loading trainer portal">
        <SkeletonCard />
      </div>
    );
  }

  return <>{children}</>;
}

// fe §3 route map — `(trainer)/layout.tsx`: RoleGuard(TRAINER). NOT
// `/dashboard`, which is the single unified route living outside every
// `(role)` group. Task 13.1.
export default function TrainerLayout({ children }: { children: ReactNode }) {
  return (
    <RoleGuard allow="TRAINER">
      <TrainerLayoutContent>{children}</TrainerLayoutContent>
    </RoleGuard>
  );
}
