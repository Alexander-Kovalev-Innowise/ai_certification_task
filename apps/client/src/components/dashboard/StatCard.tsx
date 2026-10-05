import Link from 'next/link';
import type { ReactNode } from 'react';

import type { DashboardMetricDelta, DashboardMetricUnit } from '../../types/dashboard';
import { NavIcon, type NavIconName } from '../shell/NavIcon';

export interface StatCardProps {
  label: string;
  value: number;
  unit?: DashboardMetricUnit;
  hint?: string;
  delta?: DashboardMetricDelta;
  icon: NavIconName;
  /** When set the whole card is a link (e.g. Pending Approvals -> /approvals). */
  href?: string;
  /** Optional footer slot (e.g. a Sparkline). */
  children?: ReactNode;
}

const CARD_CLASS = 'flex h-full flex-col gap-sm rounded-md border border-border-soft bg-surface-1 p-md shadow-card-soft';
const LINK_CLASS =
  'transition-[border-color,transform] duration-150 hover:-translate-y-0.5 hover:border-brand-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary motion-reduce:transition-none motion-reduce:hover:translate-y-0';

const UNIT_SUFFIX: Record<DashboardMetricUnit, string> = { count: '', percent: '%', hours: 'h' };

const DELTA_STYLE = {
  up: { className: 'bg-success/15 text-success', arrow: '↑', word: 'Up' },
  down: { className: 'bg-danger/15 text-danger', arrow: '↓', word: 'Down' },
  flat: { className: 'bg-surface-2 text-ink-muted', arrow: '→', word: 'No change' },
} as const;

function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(value);
}

export function DeltaPill({ delta }: { delta: DashboardMetricDelta }) {
  const style = DELTA_STYLE[delta.direction];
  const period = delta.period === 'week' ? 'previous 7 days' : 'previous 30 days';
  const description =
    delta.direction === 'flat' ? `No change versus the ${period}` : `${style.word} ${formatNumber(delta.value)} versus the ${period}`;

  return (
    <span
      data-testid="stat-delta"
      data-direction={delta.direction}
      title={description}
      className={`font-numeric inline-flex items-center gap-xxs rounded-pill px-xs text-caption font-semibold ${style.className}`}
    >
      <span aria-hidden="true">
        {style.arrow}
        {delta.direction !== 'flat' && ` ${formatNumber(delta.value)}`}
      </span>
      <span className="sr-only">{description}</span>
    </span>
  );
}

export function StatCard({ label, value, unit = 'count', hint, delta, icon, href, children }: StatCardProps) {
  const content = (
    <>
      <div className="flex items-start justify-between gap-sm">
        <span
          aria-hidden="true"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-sm bg-brand-primary/15 text-brand-primary"
        >
          <NavIcon name={icon} size={20} />
        </span>
        {delta && <DeltaPill delta={delta} />}
      </div>
      <div className="flex flex-col gap-xxs">
        <p className="flex items-baseline gap-xxs text-ink">
          <span className="font-numeric text-[28px] font-semibold leading-9">{formatNumber(value)}</span>
          {UNIT_SUFFIX[unit] && <span className="text-body-lg font-semibold text-ink-muted">{UNIT_SUFFIX[unit]}</span>}
        </p>
        <p className="text-body font-semibold text-ink-muted">{label}</p>
        {hint && <p className="text-caption text-text-subtle">{hint}</p>}
      </div>
      {children}
    </>
  );

  if (href) {
    return (
      <Link href={href} className={`${CARD_CLASS} ${LINK_CLASS}`}>
        {content}
      </Link>
    );
  }

  return <div className={CARD_CLASS}>{content}</div>;
}

export function StatCardSkeleton() {
  return (
    <div aria-hidden="true" data-testid="stat-card-skeleton" className={CARD_CLASS}>
      <div className="h-10 w-10 animate-pulse rounded-sm bg-surface-2 motion-reduce:animate-none" />
      <div className="flex flex-col gap-xs">
        <div className="h-9 w-1/3 animate-pulse rounded-sm bg-surface-2 motion-reduce:animate-none" />
        <div className="h-4 w-2/3 animate-pulse rounded-sm bg-surface-2 motion-reduce:animate-none" />
      </div>
    </div>
  );
}
