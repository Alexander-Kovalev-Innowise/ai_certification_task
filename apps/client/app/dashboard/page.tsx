'use client';

import { CoachDashboardShell } from '../../src/components/dashboard/CoachDashboardShell';
import { PlayerDashboardShell } from '../../src/components/dashboard/PlayerDashboardShell';
import { SuperAdminDashboardShell } from '../../src/components/dashboard/SuperAdminDashboardShell';
import { TrainerDashboardShell } from '../../src/components/dashboard/TrainerDashboardShell';
import { RoleGuard } from '../../src/components/RoleGuard';
import { SkeletonCard } from '../../src/components/shared/Skeleton';
import { useBootstrap } from '../../src/hooks/useBootstrap';
import type { Role } from '../../src/types/auth';

// specs/frontend-design-spec.md §3 (2026-09-24 note) — every authenticated
// role is allowed at this leaf; there's no single role to gate on since this
// route now serves all four. Equivalent to RoleGuard's plain "is there a
// session at all" branch (redirect to /login), its role-mismatch redirect
// branch simply never fires here.
const ALL_ROLES: Role[] = ['SUPER_ADMIN', 'TRAINER', 'COACH', 'PLAYER_PARENT'];

function DashboardContent() {
  const { data, isLoading, isError } = useBootstrap();

  if (isLoading) {
    return (
      <div className="p-lg" aria-busy="true" aria-label="Loading dashboard">
        <SkeletonCard />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div role="alert" className="p-lg text-text-primary">
        Something went wrong loading your dashboard. Please try again.
      </div>
    );
  }

  switch (data.role) {
    case 'SUPER_ADMIN':
      return <SuperAdminDashboardShell ctx={data} />;
    case 'TRAINER':
      return <TrainerDashboardShell ctx={data} />;
    case 'COACH':
      return <CoachDashboardShell ctx={data} />;
    case 'PLAYER_PARENT':
      return <PlayerDashboardShell ctx={data} />;
    default:
      return null;
  }
}

export default function DashboardPage() {
  return (
    <RoleGuard allow={ALL_ROLES}>
      <DashboardContent />
    </RoleGuard>
  );
}
