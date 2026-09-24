import type { DashboardShellProps } from './DashboardShellProps';

// fe §4.6 — routing-only scaffold, same as the other three shells (fe §3,
// 2026-09-24 note): proves the unified `/dashboard` route's role dispatch
// compiles and renders end to end. The real adult-only `pendingApprovalsCount`
// tile (deny-listed for CHILD, §9.4) is a later phase's content work (fe §4.6).
export function PlayerDashboardShell({ ctx }: DashboardShellProps) {
  return (
    <section aria-labelledby="dashboard-heading" className="p-lg">
      <h1 id="dashboard-heading" className="text-xl font-semibold text-[var(--text-primary)]">
        Welcome, {ctx.user.firstName}
      </h1>
      <p className="text-[var(--text-secondary)]">Dashboard — content coming in a later phase.</p>
    </section>
  );
}
