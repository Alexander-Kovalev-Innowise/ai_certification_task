'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { apiRequest } from '../../lib/api/apiClient';
import { parseApiErrorBody } from '../../lib/api/apiError';
import { toAuthSession } from '../../lib/api/authSession';
import { useAuthStore } from '../../stores/useAuthStore';
import type { AuthSessionResponseDto, Role } from '../../types/auth';

// api §2 POST /impersonation/start — `ImpersonationStartResponseDto`.
interface ImpersonationStartResponseDto {
  accessToken: string;
  expiresIn: number;
  impersonationLogId: string;
  target: AuthSessionResponseDto['user'];
}

// Minimal shape this modal needs about its target — satisfied by both
// `UserDirectoryRow` (the `/users` list) and `UserDetailResponseDto` (the
// `/users/:id` detail page), so it doesn't couple to either.
export interface ImpersonationTarget {
  id: string;
  firstName: string;
  lastName: string;
  role: Role;
}

export interface ImpersonateConfirmModalProps {
  isOpen: boolean;
  target: ImpersonationTarget;
  onClose: () => void;
  onStarted?: () => void;
}

const DASHBOARD_PATH = '/dashboard';

const TARGET_INVALID_MESSAGE = "You can't impersonate another Super Admin.";
const NOT_ALLOWED_MESSAGE = "You're already impersonating another user. Exit that session before starting a new one.";
const RATE_LIMITED_MESSAGE = 'Too many impersonation attempts. Please wait a moment and try again.';
const GENERIC_ERROR_MESSAGE = 'Something went wrong starting impersonation. Please try again.';

// fe §4.3/§16.3 — ImpersonateConfirmModal: entry point only. Calls
// POST /impersonation/start (api §2) and populates useAuthStore's
// accessToken/user/isImpersonating with the returned impersonation token —
// ImpersonationBanner (Task 16.1) then appears immediately off that same
// store update, with no fetch of its own, since it derives its render state
// by decoding the `act` claim straight off the token this modal just wrote
// to the store. The full start -> banner -> exit loop is confirmed
// end-to-end by `ImpersonationFlow.spec.tsx` (Task 16.3), not just the two
// halves in isolation. `422 IMPERSONATION_TARGET_INVALID` (api §2 — target
// is a Super Admin) is surfaced with its own copy rather than a generic
// error, and is also pre-empted client-side: a SUPER_ADMIN target renders
// no Impersonate action at all (FR-015). Task 12.6.
export function ImpersonateConfirmModal({ isOpen, target, onClose, onStarted }: ImpersonateConfirmModalProps) {
  const router = useRouter();
  const setSession = useAuthStore((state) => state.setSession);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) {
    return null;
  }

  const targetIsSuperAdmin = target.role === 'SUPER_ADMIN';

  async function handleConfirm() {
    setIsSubmitting(true);
    setError(null);

    const res = await apiRequest('/impersonation/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetUserId: target.id }),
    });

    if (!res.ok) {
      setIsSubmitting(false);
      const errorBody = await parseApiErrorBody(res);
      if (errorBody?.errorCode === 'IMPERSONATION_TARGET_INVALID') {
        setError(TARGET_INVALID_MESSAGE);
      } else if (errorBody?.errorCode === 'IMPERSONATION_NOT_ALLOWED') {
        setError(NOT_ALLOWED_MESSAGE);
      } else if (res.status === 429) {
        setError(RATE_LIMITED_MESSAGE);
      } else {
        setError(GENERIC_ERROR_MESSAGE);
      }
      return;
    }

    const data = (await res.json()) as ImpersonationStartResponseDto;
    setSession(toAuthSession({ accessToken: data.accessToken, expiresIn: data.expiresIn, user: data.target }, true));
    setIsSubmitting(false);
    onStarted?.();
    router.push(DASHBOARD_PATH);
  }

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="impersonate-confirm-heading" className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-lg">
      <div className="w-full max-w-sm rounded-md border border-[var(--border-soft)] bg-[var(--surface-1)] p-lg shadow-card-strong">
        <h2 id="impersonate-confirm-heading" className="text-block-title font-semibold text-[var(--text-primary)]">
          Impersonate {target.firstName} {target.lastName}?
        </h2>

        {targetIsSuperAdmin ? (
          <p role="alert" className="mt-sm text-body text-[var(--danger)]">
            {TARGET_INVALID_MESSAGE}
          </p>
        ) : (
          <p className="mt-sm text-body text-[var(--text-secondary)]">
            You&apos;ll act as this {target.role.toLowerCase()} for up to 60 minutes. Every action is still audited under your own account.
          </p>
        )}

        {error && (
          <p role="alert" className="mt-sm text-body text-[var(--danger)]">
            {error}
          </p>
        )}

        <div className="mt-md flex justify-end gap-sm">
          <button type="button" onClick={onClose} disabled={isSubmitting} className="rounded-sm p-sm text-body text-[var(--text-secondary)]">
            Cancel
          </button>
          {!targetIsSuperAdmin && (
            <button
              type="button"
              onClick={handleConfirm}
              disabled={isSubmitting}
              className="rounded-sm bg-[var(--brand-primary)] p-sm text-body font-semibold text-[#0D0D0D] shadow-button-primary disabled:opacity-60"
            >
              {isSubmitting ? 'Starting…' : 'Impersonate'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
