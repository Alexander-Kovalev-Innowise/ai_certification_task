'use client';

import { useInfiniteQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { HistoryFilters, type HistoryFiltersValue } from '../../../src/components/super-admin/HistoryFilters';
import { ImpersonationHistoryTable, type ImpersonationHistoryRow } from '../../../src/components/super-admin/ImpersonationHistoryTable';
import { apiRequest } from '../../../src/lib/api/apiClient';

const PAGE_LIMIT = 50;

// api §2 GET /impersonation/history — `PaginatedResponseDto<ImpersonationLogResponseDto>` (api §0.9).
interface ImpersonationHistoryPageResponse {
  items: ImpersonationHistoryRow[];
  nextCursor: string | null;
  hasMore: boolean;
}

const EMPTY_FILTERS: HistoryFiltersValue = { adminUserId: '', targetUserId: '', dateFrom: '', dateTo: '' };

function buildQuery(filters: HistoryFiltersValue, cursor: string | null): string {
  const params = new URLSearchParams({ limit: String(PAGE_LIMIT) });
  if (cursor) {
    params.set('cursor', cursor);
  }
  if (filters.adminUserId) {
    params.set('adminUserId', filters.adminUserId);
  }
  if (filters.targetUserId) {
    params.set('targetUserId', filters.targetUserId);
  }
  if (filters.dateFrom) {
    params.set('dateFrom', filters.dateFrom);
  }
  if (filters.dateTo) {
    params.set('dateTo', filters.dateTo);
  }
  return params.toString();
}

async function fetchHistory(filters: HistoryFiltersValue, cursor: string | null): Promise<ImpersonationHistoryPageResponse> {
  const res = await apiRequest(`/impersonation/history?${buildQuery(filters, cursor)}`);
  if (!res.ok) {
    throw new Error(`GET /impersonation/history failed with status ${res.status}`);
  }
  return (await res.json()) as ImpersonationHistoryPageResponse;
}

// fe §5.1/api §2 — `/impersonation-history`: GET /impersonation/history via
// useInfiniteQuery, getNextPageParam reading nextCursor/hasMore directly
// (api §0.9's keyset pagination) — no client-side offset math anywhere,
// same pattern as `/users` (Task 12.3). Task 16.2. Wrapped by
// `(super-admin)/layout.tsx`'s RoleGuard(SUPER_ADMIN), so this leaf doesn't
// re-guard.
export default function ImpersonationHistoryPage() {
  const [filters, setFilters] = useState<HistoryFiltersValue>(EMPTY_FILTERS);

  const { data, isLoading, isError, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({
    queryKey: ['impersonation-history', filters],
    queryFn: ({ pageParam }) => fetchHistory(filters, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => (lastPage.hasMore ? lastPage.nextCursor : undefined),
  });

  const items = data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <section className="flex flex-col gap-lg p-lg">
      <h1 className="text-xl font-semibold text-[var(--text-primary)]">Impersonation History</h1>

      <HistoryFilters value={filters} onChange={setFilters} />

      {isError && (
        <p role="alert" className="text-body text-[var(--danger)]">
          Something went wrong loading impersonation history. Please try again.
        </p>
      )}

      {!isLoading && !isError && (
        <ImpersonationHistoryTable items={items} hasMore={!!hasNextPage} isFetchingNextPage={isFetchingNextPage} onLoadMore={() => void fetchNextPage()} />
      )}
    </section>
  );
}
