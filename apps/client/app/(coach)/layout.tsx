'use client';

import type { ReactNode } from 'react';

import { RoleGuard } from '../../src/components/RoleGuard';
import { SkeletonCard } from '../../src/components/shared/Skeleton';
import { useBootstrap } from '../../src/hooks/useBootstrap';

// The nav shell and BrandingProvider live in the root-level
// <AuthenticatedShell> (src/components/shell/AuthenticatedShell.tsx) so they
// persist across navigation; this layout only gates the role and holds the
// content area on a skeleton until GET /me/bootstrap resolves. Split from
// CoachLayout so RoleGuard's "no session" branch never reaches this hook.
function CoachLayoutContent({ children }: { children: ReactNode }) {
  const { isLoading } = useBootstrap();

  if (isLoading) {
    return (
      <div className="p-lg" aria-busy="true" aria-label="Loading coach portal">
        <SkeletonCard />
      </div>
    );
  }

  return <>{children}</>;
}

// fe §3 route map — `(coach)/layout.tsx`: RoleGuard(COACH). NOT
// `/dashboard`, which is the single unified route living outside every
// `(role)` group. Task 15.1.
export default function CoachLayout({ children }: { children: ReactNode }) {
  return (
    <RoleGuard allow="COACH">
      <CoachLayoutContent>{children}</CoachLayoutContent>
    </RoleGuard>
  );
}
