'use client';

import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { PageHeader, PageLayout } from '../../../src/components/shared/PageLayout';
import { CoachRosterTableSkeleton } from '../../../src/components/shared/RouteSkeletons';
import { AssignCoachConflictModal, type AssignCoachTarget } from '../../../src/components/trainer/AssignCoachConflictModal';
import { CoachRosterTable, type CoachRosterRow } from '../../../src/components/trainer/CoachRosterTable';
import { ConfirmRemoveModal } from '../../../src/components/trainer/ConfirmRemoveModal';
import { InviteCoachModal, type InviteCoachResult } from '../../../src/components/trainer/InviteCoachModal';
import { useBootstrap } from '../../../src/hooks/useBootstrap';
import { apiRequest } from '../../../src/lib/api/apiClient';
import { parseApiErrorBody } from '../../../src/lib/api/apiError';
import { toast } from '../../../src/lib/toast/toast';

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

const RESEND_ERROR_MESSAGES: Record<string, string> = {
  COACH_ALREADY_ASSIGNED: 'This coach is already assigned to another trainer, so the invite cannot be resent.',
  COACH_ALREADY_ON_ROSTER: 'This coach is already on your roster.',
  INVITE_ALREADY_ACCEPTED: 'This invite was already accepted.',
};

// fe §4.4 — `/coaches`: GET /trainers/:id/coaches (own trainerId read off
// GET /me/bootstrap's TRAINER shape) + InviteCoachModal (POST
// /coaches/invite) + status toggle (PATCH /coaches/:id) + resend
// (POST /coaches/invites/:id/resend - revokes the old link, issues a new
// 7-day one) + AssignCoachConflictModal (US-01.10 availability check /
// override) + remove coach (DELETE /coaches/:id, Epic §3).
// Task 13.2. Wrapped by `(trainer)/layout.tsx`'s RoleGuard(TRAINER).
export default function CoachesPage() {
  const [isInviteModalOpen, setIsInviteModalOpen] = useState(false);
  const [assignTarget, setAssignTarget] = useState<AssignCoachTarget | null>(null);
  const [removeTarget, setRemoveTarget] = useState<CoachRosterRow | null>(null);
  const queryClient = useQueryClient();

  const { data: bootstrap } = useBootstrap();
  const trainerId = hasTrainerProfileId(bootstrap) ? bootstrap.trainerProfile.id : null;

  const { data, isLoading, isFetching, isError, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({
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

  function refreshRoster() {
    void queryClient.invalidateQueries({ queryKey: ['coaches', trainerId] });
  }

  async function handleResend(row: CoachRosterRow) {
    const res = await apiRequest(`/coaches/invites/${row.id}/resend`, { method: 'POST' });
    if (!res.ok) {
      const body = await parseApiErrorBody(res);
      toast.error((body && RESEND_ERROR_MESSAGES[body.errorCode]) || 'Could not resend the invite. Please try again.');
      refreshRoster();
      return;
    }
    toast.success(`Invite resent to ${row.email}. The previous link no longer works.`);
    refreshRoster();
  }

  async function handleConfirmRemove(): Promise<string | null> {
    if (!removeTarget) {
      return null;
    }
    const res = await apiRequest(`/coaches/${removeTarget.id}`, { method: 'DELETE' });
    if (!res.ok) {
      return res.status === 404 ? 'This coach is no longer part of your organisation.' : 'Could not remove the coach. Please try again.';
    }
    toast.success(`${removeTarget.name ?? removeTarget.email} was removed from your organisation.`);
    setRemoveTarget(null);
    refreshRoster();
    return null;
  }

  function handleInviteModalClose() {
    setIsInviteModalOpen(false);
  }

  function handleInvited(result: InviteCoachResult) {
    void result;
    toast.success('Invite sent.');
    refreshRoster();
  }

  return (
    <PageLayout>
      <PageHeader
        title="Coaches"
        actions={
          <button
            type="button"
            onClick={() => setIsInviteModalOpen(true)}
            className="btn btn-primary"
          >
            Invite Coach
          </button>
        }
      />

      {isLoading && <CoachRosterTableSkeleton />}

      {isError && (
        <p role="alert" className="text-body text-danger">
          Something went wrong loading your coach roster. Please try again.
        </p>
      )}

      {!isLoading && !isError && (
        <CoachRosterTable
          items={items}
          hasMore={!!hasNextPage}
          isFetchingNextPage={isFetchingNextPage}
          onLoadMore={() => void fetchNextPage()}
          isRefreshing={isFetching && !isFetchingNextPage && !isLoading}
          onStatusChange={(coachId, status) => statusMutation.mutate({ coachId, status })}
          onResend={(row) => void handleResend(row)}
          onAssign={(row) => setAssignTarget({ id: row.id, name: row.name ?? row.email })}
          onRemove={setRemoveTarget}
        />
      )}

      <InviteCoachModal
        key={isInviteModalOpen ? 'invite' : 'closed'}
        isOpen={isInviteModalOpen}
        onClose={handleInviteModalClose}
        onInvited={handleInvited}
      />

      <AssignCoachConflictModal
        key={assignTarget?.id ?? 'closed'}
        isOpen={assignTarget !== null}
        coach={assignTarget}
        onClose={() => setAssignTarget(null)}
      />

      <ConfirmRemoveModal
        isOpen={removeTarget !== null}
        title="Remove coach"
        description={`${removeTarget?.name ?? removeTarget?.email ?? 'This coach'} will be removed from your organisation and signed out. Their history is kept, and they can no longer act for you.`}
        confirmLabel="Remove coach"
        onClose={() => setRemoveTarget(null)}
        onConfirm={handleConfirmRemove}
      />
    </PageLayout>
  );
}
