import { PageHeader, PageLayout } from '../shared/PageLayout';

import { DashboardMetrics } from './DashboardMetrics';
import type { DashboardShellProps } from './DashboardShellProps';
import { type QuickLinkItem, QuickLinks } from './QuickLinks';

const QUICK_LINKS: readonly QuickLinkItem[] = [
  { href: '/users', title: 'Users', description: 'Browse and manage every account', icon: 'users' },
  { href: '/impersonation-history', title: 'Impersonation History', description: 'Audit trail of support sessions', icon: 'clock' },
];

// fe §4.3 — platform-wide metrics (GET /dashboard/stats, SUPER_ADMIN shape)
// followed by quick-link cards into Users / Impersonation History.
export function SuperAdminDashboardShell({ ctx }: DashboardShellProps) {
  return (
    <PageLayout aria-labelledby="dashboard-heading">
      <PageHeader
        titleId="dashboard-heading"
        title={`Welcome, ${ctx.user.firstName}`}
        subtitle="Super Admin dashboard — platform overview and quick links."
      />

      <DashboardMetrics skeletonCount={7} />

      <QuickLinks links={QUICK_LINKS} />
    </PageLayout>
  );
}
