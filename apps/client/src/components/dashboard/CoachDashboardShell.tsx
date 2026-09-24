import type { DashboardShellProps } from './DashboardShellProps';

// fe §8 point 4 — same platform-default logo fallback as TrainerDashboardShell.
const DEFAULT_LOGO_URL = '/default_logo.svg';

interface EmployingTrainerSummary {
  businessName: string;
  logoUrl: string | null;
  primaryColorHex: string | null;
}

function hasCoachShape(
  ctx: DashboardShellProps['ctx'],
): ctx is DashboardShellProps['ctx'] & {
  employingTrainer: EmployingTrainerSummary;
  availabilitySet: boolean;
} {
  return 'employingTrainer' in ctx && 'availabilitySet' in ctx;
}

// fe §4.5 — CoachDashboardShell: `GET /me/bootstrap` COACH shape
// (`CoachBootstrapDto`) — an employing-trainer card (business name, logo)
// and a prompt to set availability when `availabilitySet` is `false` (this
// is the "My Times" nudge FR-062 relies on to get a coach's grid populated
// before a trainer ever tries to schedule them). Task 15.2.
export function CoachDashboardShell({ ctx }: DashboardShellProps) {
  if (!hasCoachShape(ctx)) {
    return null;
  }

  const { employingTrainer, availabilitySet } = ctx;
  const logoUrl = employingTrainer.logoUrl ?? DEFAULT_LOGO_URL;

  return (
    <section aria-labelledby="dashboard-heading" className="flex flex-col gap-lg p-lg">
      <h1 id="dashboard-heading" className="text-xl font-semibold text-[var(--text-primary)]">
        Welcome, {ctx.user.firstName}
      </h1>

      <div className="flex items-center gap-md rounded-md border border-[var(--border-soft)] bg-[var(--surface-1)] p-md shadow-card-soft">
        {/* eslint-disable-next-line @next/next/no-img-element -- external, trainer-supplied logo URL; next/image's remote-pattern allowlist doesn't fit an arbitrary per-tenant host */}
        <img src={logoUrl} alt={`${employingTrainer.businessName} logo`} className="h-12 w-12 rounded-sm object-contain" />
        <div className="flex flex-col">
          <span className="text-caption text-[var(--text-secondary)]">Employing trainer</span>
          <span className="text-body-lg font-semibold text-[var(--text-primary)]">{employingTrainer.businessName}</span>
        </div>
      </div>

      {!availabilitySet && (
        <p role="status" className="rounded-md border border-[var(--warning)] bg-[var(--surface-1)] p-md text-body text-[var(--text-primary)]">
          You haven&apos;t set your availability yet.{' '}
          <a href="/my-times" className="font-semibold text-[var(--brand-primary)] hover:underline">
            Set your availability
          </a>{' '}
          so your trainer knows when you&apos;re free to coach.
        </p>
      )}
    </section>
  );
}
