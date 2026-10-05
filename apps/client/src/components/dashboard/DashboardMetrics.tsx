'use client';

import type { ReactNode } from 'react';

import { useDashboardStats } from '../../hooks/useDashboardStats';
import type { DashboardSeries } from '../../types/dashboard';
import type { NavIconName } from '../shell/NavIcon';

import { Sparkline } from './Sparkline';
import { StatCard, StatCardSkeleton } from './StatCard';

const METRIC_ICONS: Record<string, NavIconName> = {
  total_users: 'users',
  active_trainers: 'user-check',
  active_coaches: 'user-check',
  active_players_parents: 'users',
  inactive_accounts: 'user-x',
  new_users_30d: 'user-plus',
  impersonation_sessions_7d: 'shield',
  connected_players: 'users',
  new_players_30d: 'user-plus',
  pending_coach_invites: 'mail',
  active_share_links: 'link',
  share_link_redemptions_30d: 'trending-up',
  players_with_availability_pct: 'calendar',
  coach_overrides_30d: 'clock',
  weekly_slots: 'calendar',
  weekly_hours: 'clock',
  availability_overrides_30d: 'clock',
  team_coaches: 'users',
  profiles: 'user',
  connected_trainers: 'user-check',
  pending_approvals: 'check-circle',
  availability_set_pct: 'calendar',
};

// Which daily series decorates which metric card with a sparkline.
const SERIES_FOR_METRIC: Record<string, string> = {
  new_users_30d: 'new_users_daily',
  new_players_30d: 'new_players_daily',
};

const GRID_CLASS = 'grid grid-cols-[repeat(auto-fit,minmax(12rem,1fr))] gap-md';

export interface DashboardMetricsProps {
  /** Cards rendered first (e.g. bootstrap-backed tiles that need no extra request). */
  leading?: ReactNode;
  /** Metric keys already covered by `leading`, to avoid duplicate cards. */
  excludeKeys?: readonly string[];
  skeletonCount?: number;
}

export function DashboardMetrics({ leading, excludeKeys = [], skeletonCount = 4 }: DashboardMetricsProps) {
  const { data, isLoading, isError, refetch, isFetching } = useDashboardStats();

  let body: ReactNode;
  if (isLoading) {
    body = Array.from({ length: skeletonCount }, (_, index) => <StatCardSkeleton key={index} />);
  } else if (isError || !data) {
    body = (
      <div
        role="alert"
        className="col-span-full flex flex-wrap items-center justify-between gap-sm rounded-md border border-border-soft bg-surface-1 p-md text-body text-ink"
      >
        <span>We couldn&apos;t load your metrics.</span>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => void refetch()} disabled={isFetching}>
          Retry
        </button>
      </div>
    );
  } else {
    const seriesByKey = new Map<string, DashboardSeries>((data.series ?? []).map((series) => [series.key, series]));
    body = data.metrics
      .filter((metric) => !excludeKeys.includes(metric.key))
      .map((metric) => {
        const series = seriesByKey.get(SERIES_FOR_METRIC[metric.key] ?? '');
        return (
          <StatCard
            key={metric.key}
            label={metric.label}
            value={metric.value}
            unit={metric.unit}
            hint={metric.hint}
            delta={metric.delta}
            icon={METRIC_ICONS[metric.key] ?? 'bar-chart'}
          >
            {series && <Sparkline points={series.points} label={`${series.label}, last 30 days`} />}
          </StatCard>
        );
      });
  }

  return (
    <section aria-label="Key metrics" aria-busy={isLoading} className={GRID_CLASS}>
      {leading}
      {body}
    </section>
  );
}
