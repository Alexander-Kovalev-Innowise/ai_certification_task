import { PageHeader, PageLayout } from '../shared/PageLayout';

import { DashboardMetrics } from './DashboardMetrics';
import type { DashboardShellProps } from './DashboardShellProps';
import { type QuickLinkItem, QuickLinks } from './QuickLinks';
import { StatCard } from './StatCard';

const PROFILES_LINK: QuickLinkItem = {
  href: '/profiles',
  title: 'Manage Profiles',
  description: 'Player profiles and trainer connections',
  icon: 'users',
};

const APPROVALS_LINK: QuickLinkItem = {
  href: '/approvals',
  title: 'Approvals',
  description: 'Respond to purchase requests',
  icon: 'check-circle',
};

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
// CHILD-denied, api §5), so the tile (and the Approvals quick link) is
// omitted based on the field's presence — not a role/accountType check alone
// — matching §9.4's "deny-listed field" framing. The remaining metrics come
// from `GET /dashboard/stats`. Task 14.2.
export function PlayerDashboardShell({ ctx }: DashboardShellProps) {
  const pendingApprovalsCount = hasPlayerParentShape(ctx) ? ctx.pendingApprovalsCount : undefined;
  const links = pendingApprovalsCount !== undefined ? [PROFILES_LINK, APPROVALS_LINK] : [PROFILES_LINK];

  return (
    <PageLayout aria-labelledby="dashboard-heading">
      <PageHeader titleId="dashboard-heading" title={`Welcome, ${ctx.user.firstName}`} />

      <DashboardMetrics
        excludeKeys={['pending_approvals']}
        skeletonCount={3}
        leading={
          pendingApprovalsCount !== undefined ? (
            <StatCard label="Pending Approvals" value={pendingApprovalsCount} icon="check-circle" href="/approvals" />
          ) : null
        }
      />

      <QuickLinks links={links} />
    </PageLayout>
  );
}
