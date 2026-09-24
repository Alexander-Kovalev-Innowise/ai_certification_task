'use client';

import { useQuery } from '@tanstack/react-query';

import { apiRequest } from '../lib/api/apiClient';
import type { MeBootstrapResponse } from '../types/bootstrap';

async function fetchBootstrap(): Promise<MeBootstrapResponse> {
  const res = await apiRequest('/me/bootstrap');

  if (!res.ok) {
    throw new Error(`GET /me/bootstrap failed with status ${res.status}`);
  }

  return (await res.json()) as MeBootstrapResponse;
}

// specs/frontend-design-spec.md §3 (2026-09-24 note) / arch §14, NFR-001 —
// the single unified `/dashboard` route's data source. Every role's
// dashboard shell reads this same query and switches on `role`; TanStack
// Query dedupes/caches it once per route rather than each shell re-fetching,
// which is what "one round trip, not an N+1 waterfall" means for this route.
export function useBootstrap() {
  return useQuery({
    queryKey: ['me', 'bootstrap'],
    queryFn: fetchBootstrap,
  });
}
