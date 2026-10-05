'use client';

import { useQuery } from '@tanstack/react-query';

import { apiRequest } from '../lib/api/apiClient';
import { useAuthStore } from '../stores/useAuthStore';
import type { DashboardStatsResponse } from '../types/dashboard';

async function fetchDashboardStats(): Promise<DashboardStatsResponse> {
  const res = await apiRequest('/dashboard/stats');

  if (!res.ok) {
    throw new Error(`GET /dashboard/stats failed with status ${res.status}`);
  }

  return (await res.json()) as DashboardStatsResponse;
}

// Role-aware dashboard metrics. Keyed by the effective user id so an
// impersonation switch never serves the previous identity's numbers.
export function useDashboardStats() {
  const userId = useAuthStore((state) => state.user?.id ?? null);

  return useQuery({
    queryKey: ['dashboard', 'stats', userId],
    queryFn: fetchDashboardStats,
  });
}
