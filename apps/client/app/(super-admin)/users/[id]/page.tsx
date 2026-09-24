'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { useState } from 'react';

import { SkeletonCard } from '../../../../src/components/shared/Skeleton';
import { DeactivateConfirmModal } from '../../../../src/components/super-admin/DeactivateConfirmModal';
import { GdprDeleteConfirmModal } from '../../../../src/components/super-admin/GdprDeleteConfirmModal';
import { ImpersonateConfirmModal } from '../../../../src/components/super-admin/ImpersonateConfirmModal';
import { UserDetailForm, type UserDetailResponseDto } from '../../../../src/components/super-admin/UserDetailForm';
import { apiRequest } from '../../../../src/lib/api/apiClient';

async function fetchUser(id: string): Promise<UserDetailResponseDto> {
  const res = await apiRequest(`/users/${id}`);

  if (res.status === 404) {
    throw new Error('NOT_FOUND');
  }
  if (!res.ok) {
    throw new Error(`GET /users/${id} failed with status ${res.status}`);
  }
  return (await res.json()) as UserDetailResponseDto;
}

// fe §4.3 — `/users/[id]` detail: GET/PATCH /users/:id, deactivate/
// reactivate/GDPR-delete actions (`UserDetailForm`, `DeactivateConfirmModal`,
// `GdprDeleteConfirmModal`). Cross-tenant/unauthorized reads return `404`,
// never `403` (Layer 3 convention) — this leaf treats a 404 as simply "not
// found," with no separate forbidden branch to distinguish it from. Wrapped
// by `(super-admin)/layout.tsx`'s RoleGuard(SUPER_ADMIN). Task 12.5.
//
// Reads the dynamic segment via `useParams()` rather than the Promise-based
// `params` prop (Next 15+'s async-params convention for Server Components)
// — this page's interactivity (query, two confirm modals) needs to be a
// Client Component either way, and `useParams()` is already resolved
// synchronously on the client, unlike `use(params)`, which would suspend
// and needs a Suspense boundary this route has no other reason to add.
export default function UserDetailPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [isDeactivateModalOpen, setIsDeactivateModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [isImpersonateModalOpen, setIsImpersonateModalOpen] = useState(false);

  const {
    data: user,
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ['users', id],
    queryFn: () => fetchUser(id),
    retry: false,
  });

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ['users', id] });
    void queryClient.invalidateQueries({ queryKey: ['users'] });
  }

  if (isLoading) {
    return (
      <div className="p-lg" aria-busy="true" aria-label="Loading user">
        <SkeletonCard />
      </div>
    );
  }

  if (isError || !user) {
    const notFound = error instanceof Error && error.message === 'NOT_FOUND';
    return (
      <div role="alert" className="p-lg text-[var(--text-primary)]">
        {notFound ? 'This user could not be found.' : 'Something went wrong loading this user. Please try again.'}
      </div>
    );
  }

  const isDeactivated = user.status === 'INACTIVE';
  const isDeleted = user.status === 'DELETED';

  return (
    <section className="flex flex-col gap-lg p-lg">
      <h1 className="text-xl font-semibold text-[var(--text-primary)]">
        {user.firstName} {user.lastName}
      </h1>

      <UserDetailForm user={user} onSaved={invalidate} />

      {!isDeleted && (
        <div className="flex gap-sm">
          <button
            type="button"
            onClick={() => setIsDeactivateModalOpen(true)}
            className="rounded-sm border border-[var(--border-soft)] p-sm text-body text-[var(--text-primary)]"
          >
            {isDeactivated ? 'Reactivate user' : 'Deactivate user'}
          </button>
          <button
            type="button"
            onClick={() => setIsDeleteModalOpen(true)}
            className="rounded-sm border border-[var(--danger)] p-sm text-body text-[var(--danger)]"
          >
            Delete user (GDPR)
          </button>
          {user.role !== 'SUPER_ADMIN' && (
            <button
              type="button"
              onClick={() => setIsImpersonateModalOpen(true)}
              className="rounded-sm border border-[var(--border-soft)] p-sm text-body text-[var(--text-primary)]"
            >
              Impersonate
            </button>
          )}
        </div>
      )}

      <DeactivateConfirmModal
        isOpen={isDeactivateModalOpen}
        action={isDeactivated ? 'reactivate' : 'deactivate'}
        userId={id}
        onClose={() => setIsDeactivateModalOpen(false)}
        onSuccess={() => {
          setIsDeactivateModalOpen(false);
          invalidate();
        }}
      />

      <GdprDeleteConfirmModal
        isOpen={isDeleteModalOpen}
        userId={id}
        onClose={() => setIsDeleteModalOpen(false)}
        onDeleted={() => {
          setIsDeleteModalOpen(false);
          invalidate();
        }}
      />

      <ImpersonateConfirmModal isOpen={isImpersonateModalOpen} target={user} onClose={() => setIsImpersonateModalOpen(false)} />
    </section>
  );
}
