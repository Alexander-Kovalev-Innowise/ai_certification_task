'use client';

import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { CoachRosterTableSkeleton } from '../../../src/components/shared/RouteSkeletons';
import { CoachRosterTable, type CoachRosterRow, type ResendTarget } from '../../../src/components/trainer/CoachRosterTable';
import { InviteCoachModal, type InviteCoachResult } from '../../../src/components/trainer/InviteCoachModal';
import { useBootstrap } from '../../../src/hooks/useBootstrap';
import { apiRequest } from '../../../src/lib/api/apiClient';

const PAGE_LIMIT = 50;

// api §4.2 GET /trainers/:id/coaches — `PaginatedResponseDto<CoachRosterRowDto>`.
interface CoachesPageResponse {
  items: CoachRosterRow[];
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

async function fetchCoaches(trainerId: string, cursor: string | null): Promise<CoachesPageResponse> {
  const params = new URLSearchParams({ limit: String(PAGE_LIMIT) });
  if (cursor) {
    params.set('cursor', cursor);
  }
  const res = await apiRequest(`/trainers/${trainerId}/coaches?${params.toString()}`);
  if (!res.ok) {
    throw new Error(`GET /trainers/${trainerId}/coaches failed with status ${res.status}`);
  }
  return (await res.json()) as CoachesPageResponse;
}

// fe §4.4 — `/coaches`: GET /trainers/:id/coaches (own trainerId read off
// GET /me/bootstrap's TRAINER shape) + InviteCoachModal (POST
// /coaches/invite) + status toggle (PATCH /coaches/:id) + resend-on-expiry
// (re-invites the same email/name — no dedicated resend endpoint exists).
// Task 13.2. Wrapped by `(trainer)/layout.tsx`'s RoleGuard(TRAINER).
export default function CoachesPage() {
  const [isInviteModalOpen, setIsInviteModalOpen] = useState(false);
  const [resendTarget, setResendTarget] = useState<ResendTarget | undefined>(undefined);
  const queryClient = useQueryClient();

  const { data: bootstrap } = useBootstrap();
  const trainerId = hasTrainerProfileId(bootstrap) ? bootstrap.trainerProfile.id : null;

  const { data, isLoading, isError, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({
    queryKey: ['coaches', trainerId],
    queryFn: ({ pageParam }) => fetchCoaches(trainerId as string, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => (lastPage.hasMore ? lastPage.nextCursor : undefined),
    enabled: !!trainerId,
  });

  const statusMutation = useMutation({
    mutationFn: ({ coachId, status }: { coachId: string; status: 'ACTIVE' | 'PENDING' }) =>
      apiRequest(`/coaches/${coachId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['coaches', trainerId] }),
  });

  const items = data?.pages.flatMap((page) => page.items) ?? [];

  function handleResend(target: ResendTarget) {
    setResendTarget(target);
    setIsInviteModalOpen(true);
  }

  function handleInviteModalClose() {
    setIsInviteModalOpen(false);
    setResendTarget(undefined);
  }

  function handleInvited(_result: InviteCoachResult) {
    void queryClient.invalidateQueries({ queryKey: ['coaches', trainerId] });
  }

  return (
    <section className="flex flex-col gap-lg p-lg">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-[var(--text-primary)]">Coaches</h1>
        <button
          type="button"
          onClick={() => {
            setResendTarget(undefined);
            setIsInviteModalOpen(true);
          }}
          className="rounded-sm bg-[var(--brand-primary)] p-sm text-body font-semibold text-[#0D0D0D] shadow-button-primary"
        >
          Invite Coach
        </button>
      </div>

      {isLoading && <CoachRosterTableSkeleton />}

      {isError && (
        <p role="alert" className="text-body text-[var(--danger)]">
          Something went wrong loading your coach roster. Please try again.
        </p>
      )}

      {!isLoading && !isError && (
        <CoachRosterTable
          items={items}
          hasMore={!!hasNextPage}
          isFetchingNextPage={isFetchingNextPage}
          onLoadMore={() => void fetchNextPage()}
          onStatusChange={(coachId, status) => statusMutation.mutate({ coachId, status })}
          onResend={handleResend}
        />
      )}

      <InviteCoachModal
        key={isInviteModalOpen ? (resendTarget?.email ?? 'invite') : 'closed'}
        isOpen={isInviteModalOpen}
        onClose={handleInviteModalClose}
        onInvited={handleInvited}
        resendTarget={resendTarget}
      />
    </section>
  );
}
