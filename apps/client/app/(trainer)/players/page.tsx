'use client';

import { keepPreviousData, useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { PageHeader, PageLayout } from '../../../src/components/shared/PageLayout';
import { PlayerRosterTableSkeleton } from '../../../src/components/shared/RouteSkeletons';
import { AvailabilityFilterBar, type AvailabilityFilter } from '../../../src/components/trainer/AvailabilityFilterBar';
import { ConfirmRemoveModal } from '../../../src/components/trainer/ConfirmRemoveModal';
import { PlayerRosterTable, type RosterRow } from '../../../src/components/trainer/PlayerRosterTable';
import { useBootstrap } from '../../../src/hooks/useBootstrap';
import { useDebouncedValue } from '../../../src/hooks/useDebouncedValue';
import { apiRequest } from '../../../src/lib/api/apiClient';
import { toast } from '../../../src/lib/toast/toast';

const PAGE_LIMIT = 50;
const FILTER_DEBOUNCE_MS = 300;
const EMPTY_FILTER: AvailabilityFilter = {};

// api §4.3 GET /trainers/:id/players — `PaginatedResponseDto<RosterRowDto>`
// plus `availableCount`/`totalCount` (US-01.09, spanning ALL pages).
interface PlayersPageResponse {
  items: RosterRow[];
  nextCursor: string | null;
  hasMore: boolean;
  availableCount: number;
  totalCount: number;
}

function hasTrainerProfileId(data: unknown): data is { trainerProfile: { id: string } } {
  return (
    typeof data === 'object' &&
    data !== null &&
    'trainerProfile' in data &&
    typeof (data as { trainerProfile?: unknown }).trainerProfile === 'object' &&
    (data as { trainerProfile: { id?: unknown } }).trainerProfile !== null &&
    typeof (data as { trainerProfile: { id?: unknown } }).trainerProfile.id === 'string'
  );
}

async function fetchPlayers(trainerId: string, filter: AvailabilityFilter, cursor: string | null): Promise<PlayersPageResponse> {
  const params = new URLSearchParams({ limit: String(PAGE_LIMIT) });
  if (cursor) {
    params.set('cursor', cursor);
  }
  if (filter.dayOfWeek !== undefined) {
    params.set('dayOfWeek', String(filter.dayOfWeek));
  }
  if (filter.startTime !== undefined) {
    params.set('startTime', String(filter.startTime));
  }
  if (filter.endTime !== undefined) {
    params.set('endTime', String(filter.endTime));
  }

  const res = await apiRequest(`/trainers/${trainerId}/players?${params.toString()}`);
  if (!res.ok) {
    throw new Error(`GET /trainers/${trainerId}/players failed with status ${res.status}`);
  }
  return (await res.json()) as PlayersPageResponse;
}

// fe §4.4 — `/players` (trainer-side): `GET /trainers/:id/players`
// (`?dayOfWeek&startTime&endTime`, own trainerId read off `GET
// /me/bootstrap`'s TRAINER shape) + `AvailabilityFilterBar` — explicitly the
// FR-070 narrow slice `{player, age, availabilitySummary}` only, **no
// notes/tags/pipeline** (architecture §18). This is a trainer viewing
// player availability for scheduling ("Best Times"), not the player/parent
// `(player)` group's own availability editor (Task 14.6/14.7) — belongs
// under `(trainer)`, per fe §3's route map (`(trainer)/players/page.tsx`,
// distinct from the player/parent group entirely). Task 14.9. Wrapped by
// `(trainer)/layout.tsx`'s RoleGuard(TRAINER).
export default function PlayersPage() {
  const [filter, setFilter] = useState<AvailabilityFilter>(EMPTY_FILTER);
  const [removeTarget, setRemoveTarget] = useState<RosterRow | null>(null);
  const queryClient = useQueryClient();

  const { data: bootstrap } = useBootstrap();
  const trainerId = hasTrainerProfileId(bootstrap) ? bootstrap.trainerProfile.id : null;

  // Inputs stay immediate (`filter`); the query only sees the debounced copy,
  // and `placeholderData: keepPreviousData` keeps the old rows on screen while
  // the next filter's page loads.
  const debouncedFilter = useDebouncedValue(filter, FILTER_DEBOUNCE_MS);

  const { data, isLoading, isFetching, isError, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({
    queryKey: ['players', trainerId, debouncedFilter],
    queryFn: ({ pageParam }) => fetchPlayers(trainerId as string, debouncedFilter, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => (lastPage.hasMore ? lastPage.nextCursor : undefined),
    enabled: !!trainerId,
    placeholderData: keepPreviousData,
  });

  const isInitialLoading = isLoading && !data;
  const isRefreshing = (isFetching && !isFetchingNextPage && !isLoading) || filter !== debouncedFilter;
  const hasActiveFilters = filter.dayOfWeek !== undefined || filter.startTime !== undefined || filter.endTime !== undefined;

  const items = data?.pages.flatMap((page) => page.items) ?? [];
  const counts = data?.pages[data.pages.length - 1];

  async function handleConfirmRemove(): Promise<string | null> {
    if (!removeTarget) {
      return null;
    }
    const res = await apiRequest(`/trainers/${trainerId}/players/${removeTarget.playerProfileId}`, { method: 'DELETE' });
    if (!res.ok) {
      return res.status === 404 ? 'This player is no longer on your roster.' : 'Could not remove the player. Please try again.';
    }
    toast.success(`${removeTarget.name} was removed from your roster.`);
    setRemoveTarget(null);
    void queryClient.invalidateQueries({ queryKey: ['players', trainerId] });
    return null;
  }

  return (
    <PageLayout>
      <PageHeader title="Players" />

      <AvailabilityFilterBar value={filter} onChange={setFilter} />

      {hasActiveFilters && counts && (
        <p role="status" className="text-body text-text-secondary">
          Players available at this time: <span className="font-semibold text-ink">{counts.availableCount}</span> out of{' '}
          <span className="font-semibold text-ink">{counts.totalCount}</span>
        </p>
      )}

      {isInitialLoading && <PlayerRosterTableSkeleton />}

      {isError && (
        <p role="alert" className="text-body text-danger">
          Something went wrong loading your player roster. Please try again.
        </p>
      )}

      {!isInitialLoading && !isError && (
        <PlayerRosterTable
          items={items}
          hasMore={!!hasNextPage}
          isFetchingNextPage={isFetchingNextPage}
          onLoadMore={() => void fetchNextPage()}
          isRefreshing={isRefreshing}
          onClearFilters={hasActiveFilters ? () => setFilter(EMPTY_FILTER) : undefined}
          onRemove={setRemoveTarget}
        />
      )}

      <ConfirmRemoveModal
        isOpen={removeTarget !== null}
        title="Remove player"
        description={`${removeTarget?.name ?? 'This player'} will be removed from your roster. Their family can rejoin later with a share link, and their history is kept.`}
        confirmLabel="Remove player"
        onClose={() => setRemoveTarget(null)}
        onConfirm={handleConfirmRemove}
      />
    </PageLayout>
  );
}
