'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { useState } from 'react';

import type { AddTrainerAssociationResult } from '../../../../src/components/player/AddTrainerModal';
import { AddTrainerModal } from '../../../../src/components/player/AddTrainerModal';
import type { AvailableTrainerOption } from '../../../../src/components/player/ChildProfileForm';
import { ProfileEditForm, type PlayerProfileDetail } from '../../../../src/components/player/ProfileEditForm';
import { RemoveTrainerConfirmModal } from '../../../../src/components/player/RemoveTrainerConfirmModal';
import { TrainerAssociationList, type TrainerAssociationRow } from '../../../../src/components/player/TrainerAssociationList';
import { SkeletonCard } from '../../../../src/components/shared/Skeleton';
import { useBootstrap } from '../../../../src/hooks/useBootstrap';
import { apiRequest } from '../../../../src/lib/api/apiClient';
import { useAuthStore } from '../../../../src/stores/useAuthStore';
import type { AccountType } from '../../../../src/types/auth';

interface PlayerParentBootstrapShape {
  accountType: AccountType;
  contexts: { trainerId: string; trainerDisplayName: string }[];
}

function hasPlayerParentShape(data: unknown): data is PlayerParentBootstrapShape {
  return typeof data === 'object' && data !== null && 'accountType' in data && Array.isArray((data as { contexts?: unknown }).contexts);
}

/** FR-032's "My Trainers" — the family's already-connected trainers, de-duplicated for AddTrainerModal's picker (same helper as `/profiles`' ChildProfileForm wiring, Task 14.3). */
function dedupeTrainers(contexts: { trainerId: string; trainerDisplayName: string }[]): AvailableTrainerOption[] {
  const seen = new Map<string, string>();
  for (const context of contexts) {
    if (!seen.has(context.trainerId)) {
      seen.set(context.trainerId, context.trainerDisplayName);
    }
  }
  return [...seen.entries()].map(([id, businessName]) => ({ id, businessName }));
}

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
// (`TrainerAssociationList`) + Add Trainer/Remove wiring (`AddTrainerModal`/
// `RemoveTrainerConfirmModal`, Task 14.5 — this file necessarily gets
// touched again by that task, since Task 14.4 couldn't import components
// Task 14.5 hadn't created yet).
//
// Reads the dynamic segment via `useParams()` rather than the Promise-based
// `params` prop, same reasoning as `/users/[id]` (Task 12.5): this page is a
// Client Component either way (queries, forms), and `useParams()` resolves
// synchronously on the client. Wrapped by `(player)/layout.tsx`'s
// RoleGuard(PLAYER_PARENT). Tasks 14.4-14.5.
export default function ProfileDetailPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const accountType = useAuthStore((state) => state.user?.accountType);
  // MANAGE_TRAINER_ASSOCIATIONS/allowChildTokenSpendWithoutApproval-editing
  // are both CHILD-denied (FR-051/FR-041) — one derived flag covers both.
  const canManage = accountType !== 'CHILD';

  const [isAddTrainerOpen, setIsAddTrainerOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<TrainerAssociationRow | null>(null);

  const { data: bootstrap } = useBootstrap();
  const availableTrainers = hasPlayerParentShape(bootstrap) ? dedupeTrainers(bootstrap.contexts) : [];

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

  function handleAdded(_result: AddTrainerAssociationResult) {
    // AddTrainerAssociationResult carries no businessName (verified against
    // the real AssociationsService response, AddTrainerModal.tsx's own
    // note) — refetch the trainers list rather than build a display row
    // from the mutation response.
    void queryClient.invalidateQueries({ queryKey: ['player-profiles', id, 'trainers'] });
    void queryClient.invalidateQueries({ queryKey: ['me', 'contexts'] });
  }

  function handleRemoved(trainerId: string) {
    queryClient.setQueryData(['player-profiles', id, 'trainers'], (rows: TrainerAssociationRow[] | undefined) =>
      (rows ?? []).filter((row) => row.trainerId !== trainerId),
    );
    setRemoveTarget(null);
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
        onAddTrainer={() => setIsAddTrainerOpen(true)}
        onRemoveTrainer={(trainer) => setRemoveTarget(trainer)}
      />

      <AddTrainerModal
        key={isAddTrainerOpen ? 'open' : 'closed'}
        isOpen={isAddTrainerOpen}
        profileId={id}
        availableTrainers={availableTrainers}
        onClose={() => setIsAddTrainerOpen(false)}
        onAdded={handleAdded}
      />

      <RemoveTrainerConfirmModal
        isOpen={removeTarget !== null}
        profileId={id}
        trainer={removeTarget}
        onClose={() => setRemoveTarget(null)}
        onRemoved={handleRemoved}
      />
    </section>
  );
}
