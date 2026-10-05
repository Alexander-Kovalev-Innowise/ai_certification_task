'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { useState } from 'react';

import { AvailabilityGrid, type AvailabilityGridSlot } from '../../../../../src/components/shared/AvailabilityGrid';
import { PageHeader, PageLayout } from '../../../../../src/components/shared/PageLayout';
import { AvailabilityGridSkeleton } from '../../../../../src/components/shared/RouteSkeletons';
import { apiRequest } from '../../../../../src/lib/api/apiClient';

interface AvailabilityGridResponse {
  playerProfileId: string;
  slots: AvailabilityGridSlot[];
}

async function fetchAvailability(id: string): Promise<AvailabilityGridResponse> {
  const res = await apiRequest(`/player-profiles/${id}/availability`);
  if (!res.ok) {
    throw new Error(`GET /player-profiles/${id}/availability failed with status ${res.status}`);
  }
  return (await res.json()) as AvailabilityGridResponse;
}

async function putAvailability(id: string, slots: AvailabilityGridSlot[]): Promise<AvailabilityGridResponse> {
  const res = await apiRequest(`/player-profiles/${id}/availability`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slots }),
  });
  if (!res.ok) {
    throw new Error(`PUT /player-profiles/${id}/availability failed with status ${res.status}`);
  }
  return (await res.json()) as AvailabilityGridResponse;
}

// fe §4.6/§5.4 — `/profiles/[id]/availability`: `<AvailabilityGrid
// mode="edit" subject="player">` over `GET/PUT
// /player-profiles/:id/availability` (api §4.5, FR-090). Same
// `useParams()`-over-Promise-`params` reasoning as `/profiles/[id]` (Task
// 14.4). Wrapped by `(player)/layout.tsx`'s RoleGuard(PLAYER_PARENT).
// Task 14.7.
export default function AvailabilityPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [savedMessage, setSavedMessage] = useState(false);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['player-profiles', id, 'availability'],
    queryFn: () => fetchAvailability(id),
    enabled: !!id,
  });

  const mutation = useMutation({
    mutationFn: (slots: AvailabilityGridSlot[]) => putAvailability(id, slots),
    onSuccess: (updated) => {
      queryClient.setQueryData(['player-profiles', id, 'availability'], updated);
      setSavedMessage(true);
    },
  });

  if (isLoading) {
    return (
      <PageLayout>
        <PageHeader title="Best Times" />
        <AvailabilityGridSkeleton />
      </PageLayout>
    );
  }

  if (isError || !data) {
    return (
      <PageLayout>
        <PageHeader title="Best Times" />
        <p role="alert" className="text-body text-danger">
          Something went wrong loading availability. Please try again.
        </p>
      </PageLayout>
    );
  }

  return (
    <PageLayout>
      <PageHeader title="Best Times" />

      {savedMessage && (
        <p role="status" className="text-body text-success">
          Availability saved. Trainers can see these preferences when planning sessions.
        </p>
      )}
      {mutation.isError && (
        <p role="alert" className="text-body text-danger">
          Something went wrong saving your availability. Please try again.
        </p>
      )}

      <AvailabilityGrid
        key={id}
        subject="player"
        mode="edit"
        slots={data.slots}
        isSaving={mutation.isPending}
        onSave={(slots) => {
          setSavedMessage(false);
          mutation.mutate(slots);
        }}
      />
    </PageLayout>
  );
}
