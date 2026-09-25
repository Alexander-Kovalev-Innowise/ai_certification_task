'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import type { AvailableTrainerOption, CreateChildProfileResult } from '../../../src/components/player/ChildProfileForm';
import { ChildProfileForm } from '../../../src/components/player/ChildProfileForm';
import { ProfileCardGrid, type PlayerProfileSummary } from '../../../src/components/player/ProfileCardGrid';
import { ProfileCardGridSkeleton } from '../../../src/components/shared/RouteSkeletons';
import { useBootstrap } from '../../../src/hooks/useBootstrap';
import { apiRequest } from '../../../src/lib/api/apiClient';
import type { AccountType } from '../../../src/types/auth';

interface PlayerParentBootstrapShape {
  accountType: AccountType;
  contexts: { trainerId: string; trainerDisplayName: string }[];
}

function hasPlayerParentShape(data: unknown): data is PlayerParentBootstrapShape {
  return typeof data === 'object' && data !== null && 'accountType' in data && Array.isArray((data as { contexts?: unknown }).contexts);
}

/** FR-032's "My Trainers" — the family's already-connected trainers, de-duplicated for ChildProfileForm's FR-031 checklist. */
function dedupeTrainers(contexts: { trainerId: string; trainerDisplayName: string }[]): AvailableTrainerOption[] {
  const seen = new Map<string, string>();
  for (const context of contexts) {
    if (!seen.has(context.trainerId)) {
      seen.set(context.trainerId, context.trainerDisplayName);
    }
  }
  return [...seen.entries()].map(([id, businessName]) => ({ id, businessName }));
}

async function fetchProfiles(): Promise<PlayerProfileSummary[]> {
  const res = await apiRequest('/player-profiles');
  if (!res.ok) {
    throw new Error(`GET /player-profiles failed with status ${res.status}`);
  }
  return (await res.json()) as PlayerProfileSummary[];
}

// fe §4.6 — `/profiles`: `GET /player-profiles` (self + children,
// account-management metadata per api §4.3 — not a cross-trainer content
// view, FR-022 doesn't apply) + "+Add Child" (`ChildProfileForm`, Task
// 14.3). Wrapped by `(player)/layout.tsx`'s RoleGuard(PLAYER_PARENT).
export default function ProfilesPage() {
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const { data: bootstrap } = useBootstrap();
  const accountType = hasPlayerParentShape(bootstrap) ? bootstrap.accountType : 'ADULT';
  const canAddChild = accountType !== 'CHILD';
  const availableTrainers = hasPlayerParentShape(bootstrap) ? dedupeTrainers(bootstrap.contexts) : [];

  const { data: profiles, isLoading, isError } = useQuery({
    queryKey: ['player-profiles'],
    queryFn: fetchProfiles,
  });

  function handleCreated(result: CreateChildProfileResult) {
    void queryClient.invalidateQueries({ queryKey: ['player-profiles'] });
    void queryClient.invalidateQueries({ queryKey: ['me', 'bootstrap'] });
    setWarning(result.warning ?? null);
  }

  return (
    <section className="flex flex-col gap-lg p-lg">
      <h1 className="text-xl font-semibold text-[var(--text-primary)]">Profiles</h1>

      {warning && (
        <p role="status" className="text-body text-[var(--warning)]">
          {warning}
        </p>
      )}

      {isLoading && <ProfileCardGridSkeleton />}

      {isError && (
        <p role="alert" className="text-body text-[var(--danger)]">
          Something went wrong loading your profiles. Please try again.
        </p>
      )}

      {!isLoading && !isError && (
        <ProfileCardGrid profiles={profiles ?? []} canAddChild={canAddChild} onAddChild={() => setIsFormOpen(true)} />
      )}

      <ChildProfileForm
        key={isFormOpen ? 'open' : 'closed'}
        isOpen={isFormOpen}
        onClose={() => setIsFormOpen(false)}
        onCreated={handleCreated}
        availableTrainers={availableTrainers}
      />
    </section>
  );
}
