'use client';

import { useState } from 'react';

import { apiRequest } from '../../lib/api/apiClient';

import type { TrainerAssociationRow } from './TrainerAssociationList';

export interface RemoveTrainerConfirmModalProps {
  isOpen: boolean;
  profileId: string;
  trainer: TrainerAssociationRow | null;
  onClose: () => void;
  onRemoved: (trainerId: string) => void;
}

const GENERIC_ERROR_MESSAGE = 'Something went wrong removing this trainer. Please try again.';

// fe §4.6/§9.4 — RemoveTrainerConfirmModal: "This will cancel all upcoming
// RSVPs" — a full blocking dialog (same shape as the Super Admin's
// DeactivateConfirmModal, Task 12.5), never optimistic, unlike the
// low-stakes `RevokeConfirmPopover` (Task 13.3): removing a child from a
// trainer has real downstream consequences (RSVP cancellation, api §4.3),
// so the row only updates after the server confirms. `DELETE
// /player-profiles/:id/trainers/:trainerId` (FR-032, "Remove Child from
// Trainer" — the client shows this confirmation; the server performs the
// soft-delete-with-cascade unconditionally, with no confirmation step of
// its own). Task 14.5.
export function RemoveTrainerConfirmModal({ isOpen, profileId, trainer, onClose, onRemoved }: RemoveTrainerConfirmModalProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen || !trainer) {
    return null;
  }

  function handleClose() {
    setError(null);
    onClose();
  }

  async function handleConfirm() {
    if (!trainer) {
      return;
    }
    setIsSubmitting(true);
    setError(null);

    const res = await apiRequest(`/player-profiles/${profileId}/trainers/${trainer.trainerId}`, { method: 'DELETE' });

    setIsSubmitting(false);

    if (!res.ok) {
      setError(GENERIC_ERROR_MESSAGE);
      return;
    }

    onRemoved(trainer.trainerId);
  }

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="remove-trainer-heading" className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-lg">
      <div className="w-full max-w-sm rounded-md border border-[var(--border-soft)] bg-[var(--surface-1)] p-lg shadow-card-strong">
        <h2 id="remove-trainer-heading" className="text-block-title font-semibold text-[var(--text-primary)]">
          Remove {trainer.businessName}?
        </h2>
        <p className="mt-sm text-body text-[var(--text-secondary)]">This will cancel all upcoming RSVPs with this trainer. This can&apos;t be undone.</p>

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
            disabled={isSubmitting}
            className="rounded-sm bg-[var(--danger)] p-sm text-body font-semibold text-white disabled:opacity-60"
          >
            {isSubmitting ? 'Removing…' : 'Yes, remove'}
          </button>
        </div>
      </div>
    </div>
  );
}
