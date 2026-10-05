'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';

import { FatalApiError } from '../lib/api/apiClient';
import { useAuthStore, type AuthState } from '../stores/useAuthStore';

// Cached server state belongs to ONE identity. A different user id (sign out ->
// sign in as someone else, SPA navigation) or entering/leaving impersonation must
// never be served the previous identity's `/me/bootstrap`, profile, rosters, ...
function identityKey(state: Pick<AuthState, 'user' | 'isImpersonating'>): string {
  return `${state.user?.id ?? ''}:${state.isImpersonating ? 'imp' : 'own'}`;
}

// fe §6.3 — TanStack Query owns every server-state read/write cache across
// the ~45-endpoint API surface; Zustand (useAuthStore/useTrainerContextStore)
// is reserved for genuinely client-only state. The QueryClient is created
// inside a lazy `useState` initializer, not at module scope — the standard
// Next.js App Router pattern, so each mount gets its own client instance
// instead of one leaking across server-rendered requests.
export function QueryProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Conservative default: data is fresh for 30s before a
            // background refetch is even considered, cutting "every mount
            // refetches everything" chatter across the API surface. Any
            // route needing tighter/looser freshness overrides this per
            // `useQuery` call — this is a floor, not a rule enforced
            // per-endpoint.
            staleTime: 30_000,
            retry: 1,
            // fe §9.4/Task 18.3 — a `500 TENANT_SCOPE_VIOLATION` thrown by
            // apiRequest() (apiClient.ts's `FatalApiError`) is the one
            // query-fetch failure this app wants React itself to catch,
            // via the root `ErrorBoundary` — every other query error stays
            // in the query's own `error`/`isError` state, handled inline by
            // whichever page/hook reads it (the established pattern across
            // every Phase 10-17 query-backed page).
            throwOnError: (error) => error instanceof FatalApiError,
          },
        },
      }),
  );

  useEffect(() => {
    let previous = identityKey(useAuthStore.getState());
    return useAuthStore.subscribe((state) => {
      const next = identityKey(state);
      if (next === previous) {
        return;
      }
      previous = next;
      if (state.user) {
        // Another identity is now live: wipe every cached result and refetch what is on screen.
        void queryClient.resetQueries();
      } else {
        // Signed out: nothing to refetch (and nothing may be requested without a session).
        void queryClient.cancelQueries();
        queryClient.clear();
      }
    });
  }, [queryClient]);

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
