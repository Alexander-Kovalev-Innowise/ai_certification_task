// Mirrors apps/server/src/modules/dashboard/dto/dashboard-stats-response.dto.ts
// (GET /dashboard/stats) — same hand-kept-mirror tradeoff as bootstrap.ts.
export type DashboardMetricUnit = 'count' | 'percent' | 'hours';

export interface DashboardMetricDelta {
  /** Absolute change vs the previous period (>= 0); the sign lives in `direction`. */
  value: number;
  period: 'week' | 'month';
  direction: 'up' | 'down' | 'flat';
}

export interface DashboardMetric {
  key: string;
  label: string;
  value: number;
  unit?: DashboardMetricUnit;
  hint?: string;
  delta?: DashboardMetricDelta;
}

export interface DashboardSeriesPoint {
  /** UTC day, YYYY-MM-DD. */
  date: string;
  value: number;
}

export interface DashboardSeries {
  key: string;
  label: string;
  points: DashboardSeriesPoint[];
}

export interface DashboardStatsResponse {
  role: 'SUPER_ADMIN' | 'TRAINER' | 'COACH' | 'PLAYER_PARENT';
  generatedAt: string;
  metrics: DashboardMetric[];
  series?: DashboardSeries[];
}
