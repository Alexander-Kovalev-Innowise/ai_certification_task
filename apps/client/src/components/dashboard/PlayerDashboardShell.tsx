import type { DashboardShellProps } from './DashboardShellProps';

const QUICK_LINKS = [{ href: '/profiles', label: 'Manage Profiles' }] as const;

interface PlayerParentDashboardShape {
  accountType: 'ADULT' | 'CHILD';
  pendingApprovalsCount?: number;
}

function hasPlayerParentShape(ctx: DashboardShellProps['ctx']): ctx is DashboardShellProps['ctx'] & PlayerParentDashboardShape {
  return 'accountType' in ctx;
}

// fe §4.6 — PlayerDashboardShell: `GET /me/bootstrap` PLAYER_PARENT shape
// (`PlayerParentBootstrapDto`) — adult accounts see a `pendingApprovalsCount`
// stat tile linking to `/approvals`; a `CHILD` session's bootstrap response
// never carries `pendingApprovalsCount` at all (`VIEW_GUARDIAN_DATA` is
// CHILD-denied, api §5), so the tile is omitted based on the field's
// presence — not a role/accountType check alone — matching §9.4's
// "deny-listed field" framing. Task 14.2 (correction from the plan's literal
// `(player)/dashboard/page.tsx`: the single unified `/dashboard` route,
// fe §3's 2026-09-24 note, already dispatches to this shell — no new page
// file).
export function PlayerDashboardShell({ ctx }: DashboardShellProps) {
  const pendingApprovalsCount = hasPlayerParentShape(ctx) ? ctx.pendingApprovalsCount : undefined;

  return (
    <section aria-labelledby="dashboard-heading" className="flex flex-col gap-lg p-lg">
      <h1 id="dashboard-heading" className="text-xl font-semibold text-[var(--text-primary)]">
        Welcome, {ctx.user.firstName}
      </h1>

      {pendingApprovalsCount !== undefined && (
        <a
          href="/approvals"
          className="flex-1 rounded-md border border-[var(--border-soft)] bg-[var(--surface-1)] p-md shadow-card-soft hover:border-[var(--brand-primary)]"
        >
          <p className="text-caption text-[var(--text-secondary)]">Pending Approvals</p>
          <p className="text-xl font-semibold text-[var(--text-primary)]">{pendingApprovalsCount}</p>
        </a>
      )}

      <nav aria-label="Quick links" className="flex flex-col gap-sm">
        {QUICK_LINKS.map((link) => (
          <a
            key={link.href}
            href={link.href}
            className="rounded-md border border-[var(--border-soft)] bg-[var(--surface-1)] p-md text-body-lg font-semibold text-[var(--text-primary)] shadow-card-soft hover:border-[var(--brand-primary)]"
          >
            {link.label}
          </a>
        ))}
      </nav>
    </section>
  );
}
