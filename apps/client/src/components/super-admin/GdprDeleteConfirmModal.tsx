'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

import { apiRequest } from '../../lib/api/apiClient';
import { GDPR_CONFIRM_WORD, gdprDeleteSchema, type GdprDeleteFormValues } from '../../lib/schemas/gdprDeleteSchema';

export interface GdprDeleteConfirmModalProps {
  isOpen: boolean;
  userId: string;
  onClose: () => void;
  onDeleted: () => void;
}

const TEXTAREA_CLASSNAME =
  'w-full min-w-0';

// fe §4.3/§9.4 — GdprDeleteConfirmModal: DELETE /users/:id (api §3, FR-014/
// SEC-005) with the required `{ reason }` body. Two-step, typed-confirmation
// input — this is a destructive/irreversible action (api §3: "irreversibility
// is structural, not just a service-layer if"), so it is never optimistic:
// the confirm button stays disabled until both a reason is entered and the
// literal word DELETE is typed, and a blocking spinner covers the request.
// Task 12.5.
export function GdprDeleteConfirmModal({ isOpen, userId, onClose, onDeleted }: GdprDeleteConfirmModalProps) {
  const [error, setError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<GdprDeleteFormValues>({
    resolver: zodResolver(gdprDeleteSchema),
    mode: 'onTouched',
    defaultValues: { reason: '', confirmText: '' },
  });

  if (!isOpen) {
    return null;
  }

  // Synchronous (not `formState.isValid`, which settles a tick later) so the
  // destructive button flips the instant both fields are valid.
  const canConfirm = gdprDeleteSchema.safeParse(watch()).success && !isSubmitting;

  function handleClose() {
    reset();
    setError(null);
    onClose();
  }

  const handleConfirm = handleSubmit(async (values) => {
    setError(null);

    const res = await apiRequest(`/users/${userId}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: values.reason }),
    });

    if (!res.ok) {
      setError(res.status === 409 ? 'This user has already been deleted.' : 'Something went wrong. Please try again.');
      return;
    }

    reset();
    onDeleted();
  });

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="gdpr-delete-heading" className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-lg">
      <div className="w-full max-w-[28rem] rounded-md border border-danger bg-surface-1 p-lg shadow-card-strong">
        <h2 id="gdpr-delete-heading" className="text-block-title font-semibold text-danger">
          Delete user (GDPR)
        </h2>
        <p className="mt-sm text-body text-text-secondary">
          This permanently anonymizes this user&apos;s account. This action cannot be undone.
        </p>

        <div className="mt-md flex flex-col gap-xxs">
          <label htmlFor="gdpr-delete-reason" className="field-label">
            Reason (for the retention record)
          </label>
          <textarea
            id="gdpr-delete-reason"
            rows={3}
            placeholder="e.g. User requested account erasure under GDPR Art. 17 (ticket #1234)"
            autoComplete="off"
            disabled={isSubmitting}
            className={TEXTAREA_CLASSNAME}
            aria-invalid={!!errors.reason}
            aria-describedby={errors.reason ? 'gdpr-delete-reason-error' : undefined}
            {...register('reason')}
          />
          {errors.reason && (
            <p id="gdpr-delete-reason-error" role="alert" className="text-caption text-danger">
              {errors.reason.message}
            </p>
          )}
        </div>

        <div className="mt-md flex flex-col gap-xxs">
          <label htmlFor="gdpr-delete-confirm-text" className="field-label">
            Type {GDPR_CONFIRM_WORD} to confirm
          </label>
          <input
            id="gdpr-delete-confirm-text"
            placeholder={GDPR_CONFIRM_WORD}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            disabled={isSubmitting}
            className={TEXTAREA_CLASSNAME}
            aria-invalid={!!errors.confirmText}
            aria-describedby={errors.confirmText ? 'gdpr-delete-confirm-text-error' : undefined}
            {...register('confirmText')}
          />
          {errors.confirmText && (
            <p id="gdpr-delete-confirm-text-error" role="alert" className="text-caption text-danger">
              {errors.confirmText.message}
            </p>
          )}
        </div>

        {error && (
          <p role="alert" className="mt-sm text-body text-danger">
            {error}
          </p>
        )}

        <div className="mt-md flex justify-end gap-sm">
          <button type="button" onClick={handleClose} disabled={isSubmitting} className="btn btn-ghost">
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!canConfirm}
            className="btn btn-danger"
          >
            {isSubmitting ? 'Deleting…' : 'Permanently delete'}
          </button>
        </div>
      </div>
    </div>
  );
}
