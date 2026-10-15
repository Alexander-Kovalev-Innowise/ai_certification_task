'use client';

import type { ReactNode } from 'react';

import { RoleGuard } from '../../src/components/RoleGuard';
import { SkeletonCard } from '../../src/components/shared/Skeleton';
import { useBootstrap } from '../../src/hooks/useBootstrap';

// The nav shell lives in the root-level <AuthenticatedShell>
// (src/components/shell/AuthenticatedShell.tsx) so it persists across
// navigation; this layout only gates the role and holds the content area on a
// skeleton until GET /me/bootstrap resolves.
function SuperAdminLayoutContent({ children }: { children: ReactNode }) {
  const { isLoading } = useBootstrap();

  if (isLoading) {
    return (
      <div className="p-lg" aria-busy="true" aria-label="Loading super admin portal">
        <SkeletonCard />
      </div>
    );
  }

  return <>{children}</>;
}

// fe §3/§4.3 — `(super-admin)/layout.tsx`: RoleGuard(SUPER_ADMIN). Wraps every
// Super Admin route (`/users`, `/users/[id]`, `/impersonation-history`) — NOT
// `/dashboard`, which is the single unified route living outside every
// `(role)` group (fe §3's 2026-09-24 correction, see
// apps/client/app/dashboard/page.tsx).
export default function SuperAdminLayout({ children }: { children: ReactNode }) {
  return (
    <RoleGuard allow="SUPER_ADMIN">
      <SuperAdminLayoutContent>{children}</SuperAdminLayoutContent>
    </RoleGuard>
  );
}
