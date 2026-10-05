'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';

import { DeactivateIcon, ImpersonateIcon, MailIcon, ReactivateIcon, TrashIcon } from '../../../../src/components/shared/ButtonIcons';
import { PageHeader, PageLayout } from '../../../../src/components/shared/PageLayout';
import { SkeletonCard } from '../../../../src/components/shared/Skeleton';
import { DeactivateConfirmModal } from '../../../../src/components/super-admin/DeactivateConfirmModal';
import { GdprDeleteConfirmModal } from '../../../../src/components/super-admin/GdprDeleteConfirmModal';
import { ImpersonateConfirmModal } from '../../../../src/components/super-admin/ImpersonateConfirmModal';
import { UserDetailForm, type UserDetailResponseDto } from '../../../../src/components/super-admin/UserDetailForm';
import { usePageMeta } from '../../../../src/hooks/usePageMeta';
import { apiRequest } from '../../../../src/lib/api/apiClient';
import { useToastStore } from '../../../../src/stores/useToastStore';

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
  const [isResendingSetup, setIsResendingSetup] = useState(false);
  const pushToast = useToastStore((state) => state.push);

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

  usePageMeta({ title: user ? `Edit ${user.firstName} ${user.lastName}` : undefined });

  async function resendSetupEmail() {
    if (!user) return;
    setIsResendingSetup(true);
    const res = await apiRequest(`/trainers/by-user/${id}/resend-setup`, { method: 'POST' });
    setIsResendingSetup(false);

    if (res.ok) {
      pushToast('success', `Setup email sent to ${user.email}.`);
    } else if (res.status === 409) {
      pushToast('error', 'This trainer has already completed account setup.');
      void queryClient.invalidateQueries({ queryKey: ['users', id] });
    } else {
      pushToast('error', 'Could not send the setup email. Please try again.');
    }
  }

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ['users', id] });
    void queryClient.invalidateQueries({ queryKey: ['users'] });
  }

  const backLink = (
    <Link href="/users" className="btn btn-secondary btn-sm">
      Back to users
    </Link>
  );

  if (isLoading) {
    return (
      <PageLayout aria-busy="true" aria-label="Loading user">
        <PageHeader title="Edit user" actions={backLink} />
        <SkeletonCard />
      </PageLayout>
    );
  }

  if (isError || !user) {
    const notFound = error instanceof Error && error.message === 'NOT_FOUND';
    return (
      <PageLayout>
        <PageHeader title="Edit user" actions={backLink} />
        <div role="alert" className="text-ink">
          {notFound ? 'This user could not be found.' : 'Something went wrong loading this user. Please try again.'}
        </div>
      </PageLayout>
    );
  }

  const isDeactivated = user.status === 'INACTIVE';
  const isDeleted = user.status === 'DELETED';

  return (
    <PageLayout>
      <PageHeader title="Edit user" actions={backLink} />
      <UserDetailForm
        user={user}
        onSaved={invalidate}
        actions={
          !isDeleted && (
            <>
              <button
                type="button"
                onClick={() => setIsDeactivateModalOpen(true)}
                className="btn btn-secondary w-full sm:w-auto"
              >
                {isDeactivated ? <ReactivateIcon /> : <DeactivateIcon />}
                {isDeactivated ? 'Reactivate user' : 'Deactivate user'}
              </button>
              {user.role === 'TRAINER' && user.mustChangePassword && (
                <button
                  type="button"
                  onClick={() => void resendSetupEmail()}
                  disabled={isResendingSetup}
                  className="btn btn-secondary w-full sm:w-auto"
                >
                  <MailIcon />
                  {isResendingSetup ? 'Sending…' : 'Resend setup email'}
                </button>
              )}
              {user.role !== 'SUPER_ADMIN' && (
                <button
                  type="button"
                  onClick={() => setIsImpersonateModalOpen(true)}
                  className="btn btn-secondary w-full sm:w-auto"
                >
                  <ImpersonateIcon />
                  Impersonate
                </button>
              )}
              <button
                type="button"
                onClick={() => setIsDeleteModalOpen(true)}
                className="btn btn-danger w-full sm:w-auto"
              >
                <TrashIcon />
                Delete user (GDPR)
              </button>
            </>
          )
        }
      />

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
    </PageLayout>
  );
}
