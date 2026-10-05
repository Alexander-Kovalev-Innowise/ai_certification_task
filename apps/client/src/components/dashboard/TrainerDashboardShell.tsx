import { PageHeader, PageLayout } from '../shared/PageLayout';

import { DashboardMetrics } from './DashboardMetrics';
import type { DashboardShellProps } from './DashboardShellProps';
import { type QuickLinkItem, QuickLinks } from './QuickLinks';
import { StatCard } from './StatCard';

// fe §8 point 4 — same platform-default logo path BrandingProvider falls
// back to ("falling back to the platform default mark (default_logo.svg)
// when null"), served from apps/client/public/. This shell renders its own
// branding preview directly off the bootstrap response's `branding` block
// rather than through `useBranding()`/`BrandingProvider` — the unified
// `/dashboard` route (`app/dashboard/page.tsx`) lives outside every
// `(role)` route group, so none of the per-role layouts (including
// `(trainer)/layout.tsx`, Task 13.1) wrap it.
const DEFAULT_LOGO_URL = '/default_logo.svg';

interface TrainerProfileSummary {
  businessName: string;
}

interface TrainerBrandingSummary {
  logoUrl: string | null;
  primaryColorHex: string | null;
}

const QUICK_LINKS: readonly QuickLinkItem[] = [
  { href: '/coaches', title: 'Manage Coaches', description: 'Invite and review your coaching team', icon: 'user-check' },
  { href: '/players', title: 'Players', description: 'Your roster of connected players', icon: 'users' },
  { href: '/share-links', title: 'Manage Share Links', description: 'Create and revoke sign-up links', icon: 'link' },
  { href: '/branding', title: 'Branding', description: 'Logo and colours of your portal', icon: 'palette' },
];

// Already covered by the bootstrap-backed tiles below.
const BOOTSTRAP_METRIC_KEYS = ['active_coaches', 'connected_players'] as const;

function hasTrainerShape(
  ctx: DashboardShellProps['ctx'],
): ctx is DashboardShellProps['ctx'] & {
  trainerProfile: TrainerProfileSummary;
  branding: TrainerBrandingSummary;
  coachCount: number;
  activePlayerCount: number;
} {
  return 'trainerProfile' in ctx && 'branding' in ctx && 'coachCount' in ctx && 'activePlayerCount' in ctx;
}

// fe §4.4 — TrainerDashboardShell: `GET /me/bootstrap` TRAINER shape
// (`TrainerBootstrapDto`) — a branding preview, `coachCount`/
// `activePlayerCount` tiles (available instantly from bootstrap), the rest of
// the tenant-scoped metrics from `GET /dashboard/stats`, and quick-link cards
// into the trainer's pages. Task 13.4.
export function TrainerDashboardShell({ ctx }: DashboardShellProps) {
  if (!hasTrainerShape(ctx)) {
    return null;
  }

  const { trainerProfile, branding, coachCount, activePlayerCount } = ctx;
  const logoUrl = branding.logoUrl ?? DEFAULT_LOGO_URL;

  return (
    <PageLayout aria-labelledby="dashboard-heading">
      <PageHeader titleId="dashboard-heading" title={`Welcome, ${ctx.user.firstName}`} />

      <div className="flex items-center gap-md rounded-md border border-border-soft bg-surface-1 p-md shadow-card-soft">
        {/* eslint-disable-next-line @next/next/no-img-element -- external, trainer-supplied logo URL; next/image's remote-pattern allowlist doesn't fit an arbitrary per-tenant host */}
        <img src={logoUrl} alt={`${trainerProfile.businessName} logo`} className="h-12 w-12 rounded-sm object-contain" />
        <div className="flex flex-col">
          <span className="text-body-lg font-semibold text-text-primary">{trainerProfile.businessName}</span>
          {branding.primaryColorHex && (
            <span className="flex items-center gap-xxs text-caption text-text-secondary">
              <span
                aria-hidden="true"
                className="inline-block h-3 w-3 rounded-full border border-border-soft"
                style={{ backgroundColor: branding.primaryColorHex }}
              />
              {branding.primaryColorHex}
            </span>
          )}
        </div>
      </div>

      <DashboardMetrics
        excludeKeys={BOOTSTRAP_METRIC_KEYS}
        skeletonCount={6}
        leading={
          <>
            <StatCard label="Coaches" value={coachCount} icon="user-check" href="/coaches" />
            <StatCard label="Active Players" value={activePlayerCount} icon="users" href="/players" />
          </>
        }
      />

      <QuickLinks links={QUICK_LINKS} />
    </PageLayout>
  );
}
