'use client';

import { keepPreviousData, useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { PageHeader, PageLayout } from '../../../src/components/shared/PageLayout';
import { UsersTableSkeleton } from '../../../src/components/shared/RouteSkeletons';
import { CreateTrainerModal } from '../../../src/components/super-admin/CreateTrainerModal';
import { UserFilters, type UserFiltersValue } from '../../../src/components/super-admin/UserFilters';
import { UsersTable, type UserDirectoryRow } from '../../../src/components/super-admin/UsersTable';
import { useDebouncedValue } from '../../../src/hooks/useDebouncedValue';
import { apiRequest } from '../../../src/lib/api/apiClient';

const PAGE_LIMIT = 50;

// api §3 GET /users — `PaginatedResponseDto<UserDirectoryRowDto>` (api §0.9).
interface UsersPageResponse {
  items: UserDirectoryRow[];
  nextCursor: string | null;
  hasMore: boolean;
}

const EMPTY_FILTERS: UserFiltersValue = { search: '', role: '', status: '' };
const FILTER_DEBOUNCE_MS = 300;

function buildQuery(filters: UserFiltersValue, cursor: string | null): string {
  const params = new URLSearchParams({ limit: String(PAGE_LIMIT) });
  if (cursor) {
    params.set('cursor', cursor);
  }
  if (filters.search) {
    params.set('search', filters.search);
  }
  if (filters.role) {
    params.set('role', filters.role);
  }
  if (filters.status) {
    params.set('status', filters.status);
  }
  return params.toString();
}

async function fetchUsers(filters: UserFiltersValue, cursor: string | null): Promise<UsersPageResponse> {
  const res = await apiRequest(`/users?${buildQuery(filters, cursor)}`);
  if (!res.ok) {
    throw new Error(`GET /users failed with status ${res.status}`);
  }
  return (await res.json()) as UsersPageResponse;
}

// fe §4.3 — `/users` directory: GET /users via useInfiniteQuery,
// getNextPageParam reading nextCursor/hasMore directly (api §0.9's keyset
// pagination) — no client-side offset math anywhere. Task 12.3. Wrapped by
// `(super-admin)/layout.tsx`'s RoleGuard(SUPER_ADMIN), so this leaf doesn't
// re-guard.
export default function UsersPage() {
  const [filters, setFilters] = useState<UserFiltersValue>(EMPTY_FILTERS);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const queryClient = useQueryClient();

  // Inputs stay immediate (`filters`); the query only sees the debounced copy,
  // and `placeholderData: keepPreviousData` keeps the old rows on screen while
  // the next filter's page loads, so the list never blinks to a skeleton.
  const debouncedFilters = useDebouncedValue(filters, FILTER_DEBOUNCE_MS);

  const { data, isLoading, isFetching, isError, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({
    queryKey: ['users', debouncedFilters],
    queryFn: ({ pageParam }) => fetchUsers(debouncedFilters, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => (lastPage.hasMore ? lastPage.nextCursor : undefined),
    placeholderData: keepPreviousData,
  });

  const isInitialLoading = isLoading && !data;
  const isRefreshing = (isFetching && !isFetchingNextPage && !isLoading) || filters !== debouncedFilters;
  const hasActiveFilters = filters.search !== '' || filters.role !== '' || filters.status !== '';

  const items = data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <PageLayout>
      <PageHeader
        title="Users"
        actions={
          <button type="button" onClick={() => setIsCreateModalOpen(true)} className="btn btn-primary">
            Create Trainer
          </button>
        }
      />

      <UserFilters value={filters} onChange={setFilters} />

      {isInitialLoading && <UsersTableSkeleton />}

      {isError && (
        <p role="alert" className="text-body text-danger">
          Something went wrong loading users. Please try again.
        </p>
      )}

      {!isInitialLoading && !isError && (
        <UsersTable
          items={items}
          hasMore={!!hasNextPage}
          isFetchingNextPage={isFetchingNextPage}
          onLoadMore={() => void fetchNextPage()}
          isRefreshing={isRefreshing}
          onClearFilters={hasActiveFilters ? () => setFilters(EMPTY_FILTERS) : undefined}
        />
      )}

      <CreateTrainerModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onCreated={() => void queryClient.invalidateQueries({ queryKey: ['users'] })}
      />
    </PageLayout>
  );
}
