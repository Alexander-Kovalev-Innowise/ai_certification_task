'use client';

import { useInfiniteQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { SkeletonCard } from '../../../src/components/shared/Skeleton';
import { AvailabilityFilterBar, type AvailabilityFilter } from '../../../src/components/trainer/AvailabilityFilterBar';
import { PlayerRosterTable, type RosterRow } from '../../../src/components/trainer/PlayerRosterTable';
import { useBootstrap } from '../../../src/hooks/useBootstrap';
import { apiRequest } from '../../../src/lib/api/apiClient';

const PAGE_LIMIT = 50;

// api §4.3 GET /trainers/:id/players — `PaginatedResponseDto<RosterRowDto>`.
interface PlayersPageResponse {
  items: RosterRow[];
  nextCursor: string | null;
  hasMore: boolean;
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
  const [filter, setFilter] = useState<AvailabilityFilter>({});

  const { data: bootstrap } = useBootstrap();
  const trainerId = hasTrainerProfileId(bootstrap) ? bootstrap.trainerProfile.id : null;

  const { data, isLoading, isError, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({
    queryKey: ['players', trainerId, filter],
    queryFn: ({ pageParam }) => fetchPlayers(trainerId as string, filter, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => (lastPage.hasMore ? lastPage.nextCursor : undefined),
    enabled: !!trainerId,
  });

  const items = data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <section className="flex flex-col gap-lg p-lg">
      <h1 className="text-xl font-semibold text-[var(--text-primary)]">Players</h1>

      <AvailabilityFilterBar value={filter} onChange={setFilter} />

      {isLoading && <SkeletonCard />}

      {isError && (
        <p role="alert" className="text-body text-[var(--danger)]">
          Something went wrong loading your player roster. Please try again.
        </p>
      )}

      {!isLoading && !isError && (
        <PlayerRosterTable
          items={items}
          hasMore={!!hasNextPage}
          isFetchingNextPage={isFetchingNextPage}
          onLoadMore={() => void fetchNextPage()}
        />
      )}
    </section>
  );
}
