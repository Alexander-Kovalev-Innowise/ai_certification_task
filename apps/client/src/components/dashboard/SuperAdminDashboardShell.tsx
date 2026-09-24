import type { DashboardShellProps } from './DashboardShellProps';

// fe §4.3 — deliberately sparse (api-spec §5: SUPER_ADMIN bootstrap shape
// has no stats block in Epic-01). This is a routing-only scaffold: it
// proves the unified `/dashboard` route's role dispatch (fe §3, 2026-09-24
// note) compiles and renders end to end. The real quick links into
// Users / Impersonation History are a later phase's content work (fe §4.3).
export function SuperAdminDashboardShell({ ctx }: DashboardShellProps) {
  return (
    <section aria-labelledby="dashboard-heading" className="p-lg">
      <h1 id="dashboard-heading" className="text-xl font-semibold text-[var(--text-primary)]">
        Welcome, {ctx.user.firstName}
      </h1>
      <p className="text-[var(--text-secondary)]">Super Admin dashboard — content coming in a later phase.</p>
    </section>
  );
}
