'use client';

import { useState } from 'react';

import { apiRequest } from '../../lib/api/apiClient';

export interface GdprDeleteConfirmModalProps {
  isOpen: boolean;
  userId: string;
  onClose: () => void;
  onDeleted: () => void;
}

const CONFIRM_WORD = 'DELETE';

const TEXTAREA_CLASSNAME =
  'rounded-sm border border-[var(--border-soft)] bg-[var(--surface-0)] p-sm text-body text-[var(--text-primary)] outline-none focus:border-[var(--danger)]';

// fe §4.3/§9.4 — GdprDeleteConfirmModal: DELETE /users/:id (api §3, FR-014/
// SEC-005) with the required `{ reason }` body. Two-step, typed-confirmation
// input — this is a destructive/irreversible action (api §3: "irreversibility
// is structural, not just a service-layer if"), so it is never optimistic:
// the confirm button stays disabled until both a reason is entered and the
// literal word DELETE is typed, and a blocking spinner covers the request.
// Task 12.5.
export function GdprDeleteConfirmModal({ isOpen, userId, onClose, onDeleted }: GdprDeleteConfirmModalProps) {
  const [reason, setReason] = useState('');
  const [confirmText, setConfirmText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) {
    return null;
  }

  const canConfirm = confirmText === CONFIRM_WORD && reason.trim().length > 0 && !isSubmitting;

  function handleClose() {
    setReason('');
    setConfirmText('');
    setError(null);
    onClose();
  }

  async function handleConfirm() {
    if (!canConfirm) {
      return;
    }
    setIsSubmitting(true);
    setError(null);

    const res = await apiRequest(`/users/${userId}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason }),
    });

    setIsSubmitting(false);

    if (!res.ok) {
      setError(res.status === 409 ? 'This user has already been deleted.' : 'Something went wrong. Please try again.');
      return;
    }

    setReason('');
    setConfirmText('');
    onDeleted();
  }

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="gdpr-delete-heading" className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-lg">
      <div className="w-full max-w-md rounded-md border border-[var(--danger)] bg-[var(--surface-1)] p-lg shadow-card-strong">
        <h2 id="gdpr-delete-heading" className="text-block-title font-semibold text-[var(--danger)]">
          Delete user (GDPR)
        </h2>
        <p className="mt-sm text-body text-[var(--text-secondary)]">
          This permanently anonymizes this user&apos;s account. This action cannot be undone.
        </p>

        <div className="mt-md flex flex-col gap-xxs">
          <label htmlFor="gdpr-delete-reason" className="text-body text-[var(--text-secondary)]">
            Reason (for the retention record)
          </label>
          <textarea
            id="gdpr-delete-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            disabled={isSubmitting}
            className={TEXTAREA_CLASSNAME}
          />
        </div>

        <div className="mt-md flex flex-col gap-xxs">
          <label htmlFor="gdpr-delete-confirm-text" className="text-body text-[var(--text-secondary)]">
            Type {CONFIRM_WORD} to confirm
          </label>
          <input
            id="gdpr-delete-confirm-text"
            value={confirmText}
            onChange={(event) => setConfirmText(event.target.value)}
            disabled={isSubmitting}
            className={TEXTAREA_CLASSNAME}
          />
        </div>

        {error && (
          <p role="alert" className="mt-sm text-body text-[var(--danger)]">
            {error}
          </p>
        )}

        <div className="mt-md flex justify-end gap-sm">
          <button type="button" onClick={handleClose} disabled={isSubmitting} className="rounded-sm p-sm text-body text-[var(--text-secondary)]">
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!canConfirm}
            className="rounded-sm bg-[var(--danger)] p-sm text-body font-semibold text-white disabled:opacity-60"
          >
            {isSubmitting ? 'Deleting…' : 'Permanently delete'}
          </button>
        </div>
      </div>
    </div>
  );
}
