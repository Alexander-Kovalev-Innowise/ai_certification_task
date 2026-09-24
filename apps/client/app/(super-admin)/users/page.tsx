'use client';

import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { SkeletonCard } from '../../../src/components/shared/Skeleton';
import { CreateTrainerModal } from '../../../src/components/super-admin/CreateTrainerModal';
import { UserFilters, type UserFiltersValue } from '../../../src/components/super-admin/UserFilters';
import { UsersTable, type UserDirectoryRow } from '../../../src/components/super-admin/UsersTable';
import { apiRequest } from '../../../src/lib/api/apiClient';

const PAGE_LIMIT = 50;

// api §3 GET /users — `PaginatedResponseDto<UserDirectoryRowDto>` (api §0.9).
interface UsersPageResponse {
  items: UserDirectoryRow[];
  nextCursor: string | null;
  hasMore: boolean;
}

const EMPTY_FILTERS: UserFiltersValue = { search: '', role: '', status: '' };

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

  const { data, isLoading, isError, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({
    queryKey: ['users', filters],
    queryFn: ({ pageParam }) => fetchUsers(filters, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => (lastPage.hasMore ? lastPage.nextCursor : undefined),
  });

  const items = data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <section className="flex flex-col gap-lg p-lg">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-[var(--text-primary)]">Users</h1>
        <button
          type="button"
          onClick={() => setIsCreateModalOpen(true)}
          className="rounded-sm bg-[var(--brand-primary)] p-sm text-body font-semibold text-[#0D0D0D] shadow-button-primary"
        >
          Create Trainer
        </button>
      </div>

      <UserFilters value={filters} onChange={setFilters} />

      {isLoading && <SkeletonCard />}

      {isError && (
        <p role="alert" className="text-body text-[var(--danger)]">
          Something went wrong loading users. Please try again.
        </p>
      )}

      {!isLoading && !isError && (
        <UsersTable items={items} hasMore={!!hasNextPage} isFetchingNextPage={isFetchingNextPage} onLoadMore={() => void fetchNextPage()} />
      )}

      <CreateTrainerModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onCreated={() => void queryClient.invalidateQueries({ queryKey: ['users'] })}
      />
    </section>
  );
}
