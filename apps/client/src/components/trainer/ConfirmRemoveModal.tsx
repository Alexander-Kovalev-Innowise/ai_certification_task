'use client';

import { useState } from 'react';

export interface ConfirmRemoveModalProps {
  isOpen: boolean;
  /** Dialog heading, e.g. "Remove coach". */
  title: string;
  /** Explains what removal does (soft removal, history kept). */
  description: string;
  confirmLabel: string;
  submittingLabel?: string;
  onClose: () => void;
  /** Resolve with `null` on success (modal closes) or an error message to show inline. */
  onConfirm: () => Promise<string | null>;
}

// Epic §3 "Manage own organization users" — one confirm dialog shared by the
// coach roster ("Remove coach") and the player roster ("Remove player"). The
// parent owns the request + toast + list refresh; this component only owns
// the pending state and the inline error.
export function ConfirmRemoveModal({
  isOpen,
  title,
  description,
  confirmLabel,
  submittingLabel = 'Removing…',
  onClose,
  onConfirm,
}: ConfirmRemoveModalProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) {
    return null;
  }

  function handleClose() {
    if (isSubmitting) {
      return;
    }
    setError(null);
    onClose();
  }

  async function handleConfirm() {
    setIsSubmitting(true);
    setError(null);
    const message = await onConfirm();
    setIsSubmitting(false);
    if (message) {
      setError(message);
    }
  }

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="confirm-remove-heading" className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-lg">
      <div className="w-full max-w-[26rem] rounded-md border border-border-soft bg-surface-1 p-lg shadow-card-strong">
        <h2 id="confirm-remove-heading" className="text-block-title font-semibold text-text-primary">
          {title}
        </h2>
        <p className="mt-sm text-body text-text-secondary">{description}</p>

        {error && (
          <p role="alert" className="mt-sm text-body text-danger">
            {error}
          </p>
        )}

        <div className="mt-md flex justify-end gap-sm">
          <button type="button" onClick={handleClose} disabled={isSubmitting} className="btn btn-ghost">
            Cancel
          </button>
          <button type="button" onClick={() => void handleConfirm()} disabled={isSubmitting} className="btn btn-danger">
            {isSubmitting ? submittingLabel : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
