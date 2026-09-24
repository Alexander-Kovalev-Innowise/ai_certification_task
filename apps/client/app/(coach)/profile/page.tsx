'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { CoachProfileForm, type CoachProfileDetail } from '../../../src/components/coach/CoachProfileForm';
import { SkeletonCard } from '../../../src/components/shared/Skeleton';
import { useBootstrap } from '../../../src/hooks/useBootstrap';
import type { MeBootstrapResponse } from '../../../src/types/bootstrap';

function hasCoachProfile(data: unknown): data is { coachProfile: CoachProfileDetail } {
  return typeof data === 'object' && data !== null && 'coachProfile' in data;
}

// fe §4.5 — `/profile` (Coach): `PATCH /coaches/:id` (self-fields branch),
// `CoachProfileForm` (bio, credentials, certifications, `publicProfile`
// toggle). Prefilled directly from `GET /me/bootstrap`'s COACH shape's
// `coachProfile` (`useBootstrap`, deduped against `(coach)/layout.tsx`'s own
// call) — there is no separate `GET /coaches/:id` single-resource endpoint
// to fetch instead, same "bootstrap response IS the detail view" reasoning
// `/my-times` (Task 15.3) already used for `coachProfileId`. A save updates
// the shared `['me', 'bootstrap']` cache entry directly via `setQueryData`
// so the rest of the app (e.g. a future roster view reading `publicProfile`)
// never sees a stale copy. Wrapped by `(coach)/layout.tsx`'s
// RoleGuard(COACH). Task 15.4.
export default function ProfilePage() {
  const queryClient = useQueryClient();
  const [savedMessage, setSavedMessage] = useState(false);

  const { data, isLoading, isError } = useBootstrap();

  function handleSaved(updated: CoachProfileDetail) {
    queryClient.setQueryData(['me', 'bootstrap'], (prev: MeBootstrapResponse | undefined) => {
      if (!prev || !hasCoachProfile(prev)) {
        return prev;
      }
      return { ...prev, coachProfile: updated };
    });
    setSavedMessage(true);
  }

  if (isLoading) {
    return (
      <div className="p-lg" aria-busy="true" aria-label="Loading profile">
        <SkeletonCard />
      </div>
    );
  }

  if (isError || !data || !hasCoachProfile(data)) {
    return (
      <p role="alert" className="p-lg text-body text-[var(--danger)]">
        Something went wrong loading your profile. Please try again.
      </p>
    );
  }

  return (
    <section className="flex flex-col gap-lg p-lg">
      <h1 className="text-xl font-semibold text-[var(--text-primary)]">Profile</h1>

      {savedMessage && (
        <p role="status" className="text-body text-[var(--success)]">
          Profile saved.
        </p>
      )}

      <CoachProfileForm key={data.coachProfile.id} profile={data.coachProfile} onSaved={handleSaved} />
    </section>
  );
}
