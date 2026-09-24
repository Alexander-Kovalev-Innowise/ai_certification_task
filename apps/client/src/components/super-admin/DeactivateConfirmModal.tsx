'use client';

import { useState } from 'react';

import { apiRequest } from '../../lib/api/apiClient';

import type { UserDetailResponseDto } from './UserDetailForm';

export interface DeactivateConfirmModalProps {
  isOpen: boolean;
  action: 'deactivate' | 'reactivate';
  userId: string;
  onClose: () => void;
  onSuccess: (updated: UserDetailResponseDto) => void;
}

const COPY = {
  deactivate: {
    headingId: 'deactivate-confirm-heading',
    heading: 'Deactivate user',
    body: 'This user will be signed out immediately and unable to log back in until reactivated.',
    confirmLabel: 'Deactivate',
    submittingLabel: 'Deactivating…',
    conflictMessage: 'This user is already inactive or deleted.',
  },
  reactivate: {
    headingId: 'reactivate-confirm-heading',
    heading: 'Reactivate user',
    body: 'This user will be able to log in again.',
    confirmLabel: 'Reactivate',
    submittingLabel: 'Reactivating…',
    conflictMessage: 'This user cannot be reactivated — it has been permanently deleted.',
  },
} as const;

// fe §4.3 — DeactivateConfirmModal: POST /users/:id/deactivate|/reactivate
// (api §3, FR-013/BR-011). One component covers both directions via
// `action` — the route table names a single modal for both entry points.
// Task 12.5.
export function DeactivateConfirmModal({ isOpen, action, userId, onClose, onSuccess }: DeactivateConfirmModalProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const copy = COPY[action];

  if (!isOpen) {
    return null;
  }

  async function handleConfirm() {
    setIsSubmitting(true);
    setError(null);

    const res = await apiRequest(`/users/${userId}/${action}`, { method: 'POST' });

    setIsSubmitting(false);

    if (!res.ok) {
      setError(res.status === 409 ? copy.conflictMessage : 'Something went wrong. Please try again.');
      return;
    }

    const updated = (await res.json()) as UserDetailResponseDto;
    onSuccess(updated);
  }

  return (
    <div role="dialog" aria-modal="true" aria-labelledby={copy.headingId} className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-lg">
      <div className="w-full max-w-sm rounded-md border border-[var(--border-soft)] bg-[var(--surface-1)] p-lg shadow-card-strong">
        <h2 id={copy.headingId} className="text-block-title font-semibold text-[var(--text-primary)]">
          {copy.heading}
        </h2>
        <p className="mt-sm text-body text-[var(--text-secondary)]">{copy.body}</p>

        {error && (
          <p role="alert" className="mt-sm text-body text-[var(--danger)]">
            {error}
          </p>
        )}

        <div className="mt-md flex justify-end gap-sm">
          <button type="button" onClick={onClose} disabled={isSubmitting} className="rounded-sm p-sm text-body text-[var(--text-secondary)]">
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={isSubmitting}
            className="rounded-sm bg-[var(--danger)] p-sm text-body font-semibold text-white disabled:opacity-60"
          >
            {isSubmitting ? copy.submittingLabel : copy.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
