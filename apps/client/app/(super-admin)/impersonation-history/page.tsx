'use client';

import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { PageHeader, PageLayout } from '../../../src/components/shared/PageLayout';
import { HistoryFilters, type HistoryFiltersValue } from '../../../src/components/super-admin/HistoryFilters';
import { ImpersonationHistoryTable, type ImpersonationHistoryRow } from '../../../src/components/super-admin/ImpersonationHistoryTable';
import { useDebouncedValue } from '../../../src/hooks/useDebouncedValue';
import { apiRequest } from '../../../src/lib/api/apiClient';

const PAGE_LIMIT = 50;

// api §2 GET /impersonation/history — `PaginatedResponseDto<ImpersonationLogResponseDto>` (api §0.9).
interface ImpersonationHistoryPageResponse {
  items: ImpersonationHistoryRow[];
  nextCursor: string | null;
  hasMore: boolean;
}

const EMPTY_FILTERS: HistoryFiltersValue = { adminUserId: '', targetUserId: '', dateFrom: '', dateTo: '' };
const FILTER_DEBOUNCE_MS = 300;

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

  // Inputs stay immediate (`filters`); the query only sees the debounced copy,
  // and `placeholderData: keepPreviousData` keeps the old rows on screen while
  // the next filter's page loads.
  const debouncedFilters = useDebouncedValue(filters, FILTER_DEBOUNCE_MS);

  const { data, isLoading, isFetching, isError, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({
    queryKey: ['impersonation-history', debouncedFilters],
    queryFn: ({ pageParam }) => fetchHistory(debouncedFilters, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => (lastPage.hasMore ? lastPage.nextCursor : undefined),
    placeholderData: keepPreviousData,
  });

  const isInitialLoading = isLoading && !data;
  const isRefreshing = (isFetching && !isFetchingNextPage && !isLoading) || filters !== debouncedFilters;
  const hasActiveFilters = filters.adminUserId !== '' || filters.targetUserId !== '' || filters.dateFrom !== '' || filters.dateTo !== '';

  const items = data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <PageLayout>
      <PageHeader title="Impersonation History" />

      <HistoryFilters value={filters} onChange={setFilters} />

      {isError && (
        <p role="alert" className="text-body text-danger">
          Something went wrong loading impersonation history. Please try again.
        </p>
      )}

      {!isInitialLoading && !isError && (
        <ImpersonationHistoryTable
          items={items}
          hasMore={!!hasNextPage}
          isFetchingNextPage={isFetchingNextPage}
          onLoadMore={() => void fetchNextPage()}
          isRefreshing={isRefreshing}
          onClearFilters={hasActiveFilters ? () => setFilters(EMPTY_FILTERS) : undefined}
        />
      )}
    </PageLayout>
  );
}
