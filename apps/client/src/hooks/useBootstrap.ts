'use client';

import { useQuery } from '@tanstack/react-query';

import { apiRequest } from '../lib/api/apiClient';
import { parseApiErrorBody } from '../lib/api/apiError';
import { useTrainerContextStore } from '../stores/useTrainerContextStore';
import type { MeBootstrapResponse } from '../types/bootstrap';

async function fetchBootstrap(): Promise<MeBootstrapResponse> {
  let res = await apiRequest('/me/bootstrap');

  // The selected trainer context lives in a cookie that outlives the session. When another family signs in on the
  // same browser, that stale selection is not one of their connections (403 TENANT_CONTEXT_INVALID): drop it and
  // load the bootstrap again without a context instead of leaving the portal broken.
  if (res.status === 403 && useTrainerContextStore.getState().activeTrainerId) {
    const body = await parseApiErrorBody(res.clone());
    if (body?.errorCode === 'TENANT_CONTEXT_INVALID') {
      useTrainerContextStore.getState().setActiveTrainerId(null);
      res = await apiRequest('/me/bootstrap');
    }
  }

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
