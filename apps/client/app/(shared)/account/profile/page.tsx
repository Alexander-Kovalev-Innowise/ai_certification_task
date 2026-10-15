'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { RoleGuard } from '../../../../src/components/RoleGuard';
import { AccountProfileForm, type AccountProfileValues } from '../../../../src/components/shared/AccountProfileForm';
import { ChangePasswordLink } from '../../../../src/components/shared/ChangePasswordLink';
import { PageHeader, PageLayout } from '../../../../src/components/shared/PageLayout';
import { SkeletonCard } from '../../../../src/components/shared/Skeleton';
import { TrainerBusinessForm, type TrainerBusinessValues } from '../../../../src/components/trainer/TrainerBusinessForm';
import { useBootstrap } from '../../../../src/hooks/useBootstrap';
import { useMe, type MeProfile } from '../../../../src/hooks/useMe';
import { useAuthStore } from '../../../../src/stores/useAuthStore';
import type { Role } from '../../../../src/types/auth';

// fe §3 — every authenticated role reaches this one route (the `(shared)`
// group carries no role-specific layout/RoleGuard of its own), same "all
// four roles" allow-list the unified `/dashboard` route uses.
const ALL_ROLES: Role[] = ['SUPER_ADMIN', 'TRAINER', 'COACH', 'PLAYER_PARENT'];

function formatCreatedAt(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

interface TrainerBusinessBootstrap {
  trainerProfile: { id: string; businessName: string; address?: string | null; website?: string | null; description?: string | null };
}

function hasTrainerProfile(data: unknown): data is TrainerBusinessBootstrap {
  if (typeof data !== 'object' || data === null || !('trainerProfile' in data)) {
    return false;
  }
  const { trainerProfile } = data as { trainerProfile?: unknown };
  return typeof trainerProfile === 'object' && trainerProfile !== null && typeof (trainerProfile as { id?: unknown }).id === 'string';
}

// US-01 FR-080 — a TRAINER edits their own business details here
// (`PATCH /trainers/:id`); seeded from the same bootstrap payload the rest of
// the app already holds, refreshed after a save so the dashboard stays in sync.
function TrainerBusinessSection() {
  const queryClient = useQueryClient();
  const { data } = useBootstrap();

  if (!hasTrainerProfile(data)) {
    return null;
  }
  const { trainerProfile } = data;

  function handleSaved(_updated: TrainerBusinessValues) {
    void queryClient.invalidateQueries({ queryKey: ['me', 'bootstrap'], exact: true });
  }

  return (
    <TrainerBusinessForm
      key={`${trainerProfile.id}:${trainerProfile.businessName}:${trainerProfile.address ?? ''}:${trainerProfile.website ?? ''}:${trainerProfile.description ?? ''}`}
      trainerId={trainerProfile.id}
      initial={{
        businessName: trainerProfile.businessName,
        address: trainerProfile.address ?? null,
        website: trainerProfile.website ?? null,
        description: trainerProfile.description ?? null,
      }}
      onSaved={handleSaved}
    />
  );
}

function AccountProfileContent() {
  const queryClient = useQueryClient();
  const [savedMessage, setSavedMessage] = useState(false);

  const { data, isLoading, isError } = useMe();

  function handleSaved(updated: AccountProfileValues) {
    queryClient.setQueryData(['me'], (prev: MeProfile | undefined) => (prev ? { ...prev, ...updated } : prev));
    // The shell's user pill reads the auth store; keep its name and photo in step.
    useAuthStore.setState((state) =>
      state.user ? { user: { ...state.user, firstName: updated.firstName, lastName: updated.lastName, photoUrl: updated.photoUrl ?? null } } : state,
    );
    void queryClient.invalidateQueries({ queryKey: ['me', 'bootstrap'], exact: true });
    setSavedMessage(true);
  }

  if (isLoading) {
    return (
      <PageLayout aria-busy="true" aria-label="Loading account profile">
        <PageHeader title="Account" />
        <SkeletonCard />
      </PageLayout>
    );
  }

  if (isError || !data) {
    return (
      <PageLayout>
        <PageHeader title="Account" />
        <p role="alert" className="text-body text-danger">
          Something went wrong loading your account. Please try again.
        </p>
      </PageLayout>
    );
  }

  return (
    <PageLayout>
      <PageHeader title="Account" />

      {savedMessage && (
        <p role="status" className="text-body text-success">
          Profile saved.
        </p>
      )}

      <p className="text-body text-ink-muted">
        Account created: <time dateTime={data.createdAt}>{formatCreatedAt(data.createdAt)}</time>
      </p>

      <AccountProfileForm key={data.id} profile={data} accountType={data.accountType} onSaved={handleSaved} />

      {data.role === 'TRAINER' && <TrainerBusinessSection />}

      <ChangePasswordLink />
    </PageLayout>
  );
}

// fe §3/§4.7/§7.2 — `/account/profile`: the shared basics editor every role
// uses for its own `GET/PATCH /me` (Task 2.22's `MeResponseDto`/`UpdateMeDto`),
// not a new backend contract. `AccountProfileForm` conditionally omits
// firstName/lastName/phone for a `CHILD` accountType (§7.2). Task 18.1.
export default function AccountProfilePage() {
  return (
    <RoleGuard allow={ALL_ROLES}>
      <AccountProfileContent />
    </RoleGuard>
  );
}
