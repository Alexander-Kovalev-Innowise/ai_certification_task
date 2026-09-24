import type { DashboardShellProps } from './DashboardShellProps';

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

const QUICK_LINKS = [
  { href: '/coaches', label: 'Manage Coaches' },
  { href: '/share-links', label: 'Manage Share Links' },
] as const;

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
// (`TrainerBootstrapDto`) — a branding preview (business name, logo,
// primary color swatch), `coachCount`/`activePlayerCount` stat tiles, and
// quick links into `/coaches`/`/share-links` (the two routes Task
// 13.1-13.3 add). Task 13.4.
export function TrainerDashboardShell({ ctx }: DashboardShellProps) {
  if (!hasTrainerShape(ctx)) {
    return null;
  }

  const { trainerProfile, branding, coachCount, activePlayerCount } = ctx;
  const logoUrl = branding.logoUrl ?? DEFAULT_LOGO_URL;

  return (
    <section aria-labelledby="dashboard-heading" className="flex flex-col gap-lg p-lg">
      <h1 id="dashboard-heading" className="text-xl font-semibold text-[var(--text-primary)]">
        Welcome, {ctx.user.firstName}
      </h1>

      <div className="flex items-center gap-md rounded-md border border-[var(--border-soft)] bg-[var(--surface-1)] p-md shadow-card-soft">
        {/* eslint-disable-next-line @next/next/no-img-element -- external, trainer-supplied logo URL; next/image's remote-pattern allowlist doesn't fit an arbitrary per-tenant host */}
        <img src={logoUrl} alt={`${trainerProfile.businessName} logo`} className="h-12 w-12 rounded-sm object-contain" />
        <div className="flex flex-col">
          <span className="text-body-lg font-semibold text-[var(--text-primary)]">{trainerProfile.businessName}</span>
          {branding.primaryColorHex && (
            <span className="flex items-center gap-xxs text-caption text-[var(--text-secondary)]">
              <span
                aria-hidden="true"
                className="inline-block h-3 w-3 rounded-full border border-[var(--border-soft)]"
                style={{ backgroundColor: branding.primaryColorHex }}
              />
              {branding.primaryColorHex}
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-md">
        <div className="flex-1 rounded-md border border-[var(--border-soft)] bg-[var(--surface-1)] p-md shadow-card-soft">
          <p className="text-caption text-[var(--text-secondary)]">Coaches</p>
          <p className="text-xl font-semibold text-[var(--text-primary)]">{coachCount}</p>
        </div>
        <div className="flex-1 rounded-md border border-[var(--border-soft)] bg-[var(--surface-1)] p-md shadow-card-soft">
          <p className="text-caption text-[var(--text-secondary)]">Active Players</p>
          <p className="text-xl font-semibold text-[var(--text-primary)]">{activePlayerCount}</p>
        </div>
      </div>

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
