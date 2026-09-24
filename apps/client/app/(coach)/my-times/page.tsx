'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { AvailabilityGrid, type AvailabilityGridSlot } from '../../../src/components/shared/AvailabilityGrid';
import { SkeletonCard } from '../../../src/components/shared/Skeleton';
import { useBootstrap } from '../../../src/hooks/useBootstrap';
import { apiRequest } from '../../../src/lib/api/apiClient';

interface CoachAvailabilityGridResponse {
  coachProfileId: string;
  slots: AvailabilityGridSlot[];
}

function hasCoachProfile(data: unknown): data is { coachProfile: { id: string } } {
  return typeof data === 'object' && data !== null && 'coachProfile' in data;
}

async function fetchCoachAvailability(coachProfileId: string): Promise<CoachAvailabilityGridResponse> {
  const res = await apiRequest(`/coaches/${coachProfileId}/availability`);
  if (!res.ok) {
    throw new Error(`GET /coaches/${coachProfileId}/availability failed with status ${res.status}`);
  }
  return (await res.json()) as CoachAvailabilityGridResponse;
}

async function putCoachAvailability(coachProfileId: string, slots: AvailabilityGridSlot[]): Promise<CoachAvailabilityGridResponse> {
  const res = await apiRequest(`/coaches/${coachProfileId}/availability`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slots }),
  });
  if (!res.ok) {
    throw new Error(`PUT /coaches/${coachProfileId}/availability failed with status ${res.status}`);
  }
  return (await res.json()) as CoachAvailabilityGridResponse;
}

// fe §4.5/§5.4 — `/my-times`: `<AvailabilityGrid mode="edit" subject="coach">`
// over `GET/PUT /coaches/:id/availability` (api §4.5, FR-062 "My Times") —
// Task 14.6's shared component, second consumer. The coach's own
// `coachProfileId` comes off `GET /me/bootstrap`'s COACH shape (`useBootstrap`,
// deduped against `(coach)/layout.tsx`'s own call by TanStack Query, same
// convention `/profiles/[id]` already established for contexts) — there is
// no `[id]` route segment here, unlike the player pair, since this is always
// the caller's own coach profile. Wrapped by `(coach)/layout.tsx`'s
// RoleGuard(COACH). Task 15.3.
export default function MyTimesPage() {
  const queryClient = useQueryClient();
  const [savedMessage, setSavedMessage] = useState(false);

  const { data: bootstrap, isLoading: isBootstrapLoading } = useBootstrap();
  const coachProfileId = hasCoachProfile(bootstrap) ? bootstrap.coachProfile.id : undefined;

  const { data, isLoading, isError } = useQuery({
    queryKey: ['coaches', coachProfileId, 'availability'],
    queryFn: () => fetchCoachAvailability(coachProfileId as string),
    enabled: !!coachProfileId,
  });

  const mutation = useMutation({
    mutationFn: (slots: AvailabilityGridSlot[]) => putCoachAvailability(coachProfileId as string, slots),
    onSuccess: (updated) => {
      queryClient.setQueryData(['coaches', coachProfileId, 'availability'], updated);
      setSavedMessage(true);
    },
  });

  if (isBootstrapLoading || isLoading) {
    return (
      <div className="p-lg" aria-busy="true" aria-label="Loading My Times">
        <SkeletonCard />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <p role="alert" className="p-lg text-body text-[var(--danger)]">
        Something went wrong loading your availability. Please try again.
      </p>
    );
  }

  return (
    <section className="flex flex-col gap-lg p-lg">
      <h1 className="text-xl font-semibold text-[var(--text-primary)]">My Times</h1>

      {savedMessage && (
        <p role="status" className="text-body text-[var(--success)]">
          Availability saved.
        </p>
      )}
      {mutation.isError && (
        <p role="alert" className="text-body text-[var(--danger)]">
          Something went wrong saving your availability. Please try again.
        </p>
      )}

      <AvailabilityGrid
        key={coachProfileId}
        subject="coach"
        mode="edit"
        slots={data.slots}
        isSaving={mutation.isPending}
        onSave={(slots) => {
          setSavedMessage(false);
          mutation.mutate(slots);
        }}
      />
    </section>
  );
}
