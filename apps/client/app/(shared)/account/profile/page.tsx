'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { RoleGuard } from '../../../../src/components/RoleGuard';
import { AccountProfileForm, type AccountProfileValues } from '../../../../src/components/shared/AccountProfileForm';
import { ChangePasswordLink } from '../../../../src/components/shared/ChangePasswordLink';
import { SkeletonCard } from '../../../../src/components/shared/Skeleton';
import { useMe, type MeProfile } from '../../../../src/hooks/useMe';
import type { Role } from '../../../../src/types/auth';

// fe §3 — every authenticated role reaches this one route (the `(shared)`
// group carries no role-specific layout/RoleGuard of its own), same "all
// four roles" allow-list the unified `/dashboard` route uses.
const ALL_ROLES: Role[] = ['SUPER_ADMIN', 'TRAINER', 'COACH', 'PLAYER_PARENT'];

function AccountProfileContent() {
  const queryClient = useQueryClient();
  const [savedMessage, setSavedMessage] = useState(false);

  const { data, isLoading, isError } = useMe();

  function handleSaved(updated: AccountProfileValues) {
    queryClient.setQueryData(['me'], (prev: MeProfile | undefined) => (prev ? { ...prev, ...updated } : prev));
    setSavedMessage(true);
  }

  if (isLoading) {
    return (
      <div className="p-lg" aria-busy="true" aria-label="Loading account profile">
        <SkeletonCard />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <p role="alert" className="p-lg text-body text-[var(--danger)]">
        Something went wrong loading your account. Please try again.
      </p>
    );
  }

  return (
    <section className="flex flex-col gap-lg p-lg">
      <h1 className="text-xl font-semibold text-[var(--text-primary)]">Account</h1>

      {savedMessage && (
        <p role="status" className="text-body text-[var(--success)]">
          Profile saved.
        </p>
      )}

      <AccountProfileForm key={data.id} profile={data} accountType={data.accountType} onSaved={handleSaved} />

      <ChangePasswordLink />
    </section>
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
