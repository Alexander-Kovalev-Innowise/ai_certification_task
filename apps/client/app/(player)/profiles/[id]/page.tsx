'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'next/navigation';

import { ProfileEditForm, type PlayerProfileDetail } from '../../../../src/components/player/ProfileEditForm';
import { TrainerAssociationList, type TrainerAssociationRow } from '../../../../src/components/player/TrainerAssociationList';
import { SkeletonCard } from '../../../../src/components/shared/Skeleton';
import { apiRequest } from '../../../../src/lib/api/apiClient';
import { useAuthStore } from '../../../../src/stores/useAuthStore';

async function fetchProfile(id: string): Promise<PlayerProfileDetail> {
  const res = await apiRequest(`/player-profiles/${id}`);
  if (res.status === 404) {
    throw new Error('NOT_FOUND');
  }
  if (!res.ok) {
    throw new Error(`GET /player-profiles/${id} failed with status ${res.status}`);
  }
  return (await res.json()) as PlayerProfileDetail;
}

async function fetchTrainers(id: string): Promise<TrainerAssociationRow[]> {
  const res = await apiRequest(`/player-profiles/${id}/trainers`);
  if (!res.ok) {
    throw new Error(`GET /player-profiles/${id}/trainers failed with status ${res.status}`);
  }
  return (await res.json()) as TrainerAssociationRow[];
}

// fe §4.6 — `/profiles/[id]`: `GET/PATCH /player-profiles/:id`
// (`ProfileEditForm`) + `GET /player-profiles/:id/trainers`
// (`TrainerAssociationList`). `AddTrainerModal`/`RemoveTrainerConfirmModal`
// (Task 14.5) aren't wired yet — the two trigger callbacks below are no-ops
// until that task lands and (necessarily) also touches this file, since
// Task 14.4 can't import components Task 14.5 hasn't created yet.
//
// Reads the dynamic segment via `useParams()` rather than the Promise-based
// `params` prop, same reasoning as `/users/[id]` (Task 12.5): this page is a
// Client Component either way (queries, forms), and `useParams()` resolves
// synchronously on the client. Wrapped by `(player)/layout.tsx`'s
// RoleGuard(PLAYER_PARENT). Task 14.4.
export default function ProfileDetailPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const accountType = useAuthStore((state) => state.user?.accountType);
  // MANAGE_TRAINER_ASSOCIATIONS/allowChildTokenSpendWithoutApproval-editing
  // are both CHILD-denied (FR-051/FR-041) — one derived flag covers both.
  const canManage = accountType !== 'CHILD';

  const profileQuery = useQuery({
    queryKey: ['player-profiles', id],
    queryFn: () => fetchProfile(id),
    enabled: !!id,
  });
  const trainersQuery = useQuery({
    queryKey: ['player-profiles', id, 'trainers'],
    queryFn: () => fetchTrainers(id),
    enabled: !!id,
  });

  function handleSaved(updated: PlayerProfileDetail) {
    queryClient.setQueryData(['player-profiles', id], updated);
    // `exact: true` — an inexact match would also invalidate this page's own
    // `['player-profiles', id]`/`['player-profiles', id, 'trainers']` query
    // keys (React Query's default prefix matching) and immediately trigger a
    // refetch of the value `setQueryData` just set, undoing it the moment
    // that refetch resolves. Only `/profiles`' own list query
    // (`['player-profiles']`) needs invalidating here.
    void queryClient.invalidateQueries({ queryKey: ['player-profiles'], exact: true });
  }

  function handleAddTrainer() {
    // Task 14.5: opens AddTrainerModal (manual code entry vs. "My Trainers" picker).
  }

  function handleRemoveTrainer(_trainer: TrainerAssociationRow) {
    // Task 14.5: opens RemoveTrainerConfirmModal ("This will cancel all upcoming RSVPs").
  }

  if (profileQuery.isLoading || trainersQuery.isLoading) {
    return (
      <div className="p-lg" aria-busy="true" aria-label="Loading profile">
        <SkeletonCard />
      </div>
    );
  }

  if (profileQuery.isError || !profileQuery.data) {
    return (
      <p role="alert" className="p-lg text-body text-[var(--danger)]">
        Something went wrong loading this profile. Please try again.
      </p>
    );
  }

  return (
    <section className="flex flex-col gap-lg p-lg">
      <h1 className="text-xl font-semibold text-[var(--text-primary)]">{profileQuery.data.name}</h1>

      <ProfileEditForm key={id} profile={profileQuery.data} canEditGuardianFields={canManage} onSaved={handleSaved} />

      <TrainerAssociationList
        trainers={trainersQuery.data ?? []}
        canManage={canManage}
        onAddTrainer={handleAddTrainer}
        onRemoveTrainer={handleRemoveTrainer}
      />
    </section>
  );
}
