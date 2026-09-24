import type { DashboardShellProps } from './DashboardShellProps';

const QUICK_LINKS = [
  { href: '/users', label: 'Users' },
  { href: '/impersonation-history', label: 'Impersonation History' },
] as const;

// fe §4.3 — deliberately sparse (api-spec §5: SUPER_ADMIN bootstrap shape
// has no stats block in Epic-01, "nothing in the requirements asks for an SA
// dashboard beyond the Users tool, which paginates separately"). Quick links
// into Users / Impersonation History only — Task 12.2.
export function SuperAdminDashboardShell({ ctx }: DashboardShellProps) {
  return (
    <section aria-labelledby="dashboard-heading" className="flex flex-col gap-lg p-lg">
      <h1 id="dashboard-heading" className="text-xl font-semibold text-[var(--text-primary)]">
        Welcome, {ctx.user.firstName}
      </h1>
      <p className="text-[var(--text-secondary)]">Super Admin dashboard — quick links to manage the platform.</p>

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
