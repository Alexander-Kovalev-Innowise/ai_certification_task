'use client';

import { useState } from 'react';

import { apiRequest } from '../../lib/api/apiClient';

import type { ApprovalRow } from './ApprovalCard';

export interface ApprovalDecisionModalProps {
  isOpen: boolean;
  approval: ApprovalRow | null;
  decision: 'approve' | 'deny' | null;
  onClose: () => void;
  onResolved: (updated: ApprovalRow) => void;
  /** api §4.6/§9.1 — a `409` means the 5-minute expiry sweep beat this decision; re-render as EXPIRED, not a raw conflict error. */
  onConflict: (approvalId: string) => void;
}

const GENERIC_ERROR_MESSAGE = "Something went wrong recording your decision. Please try again.";

const COPY = {
  approve: { heading: 'Approve request', confirmLabel: 'Confirm approval', confirmClass: 'bg-[var(--success)] text-[#0D0D0D]' },
  deny: { heading: 'Deny request', confirmLabel: 'Confirm denial', confirmClass: 'bg-[var(--danger)] text-white' },
} as const;

// fe §9.1 — ApprovalDecisionModal: `/approvals`' approve/deny confirmation,
// notes field, `POST /approvals/:id/approve|/deny` (api §4.6, `{ notes? }`).
// A `409 CONFLICT` — the `ApprovalExpiryJob` cron won the race against this
// click — calls `onConflict` so the page can re-fetch and re-render the
// single approval as `EXPIRED` with a toast, rather than surfacing a raw
// conflict error (§9.1's own framing). Task 14.8.
export function ApprovalDecisionModal({ isOpen, approval, decision, onClose, onResolved, onConflict }: ApprovalDecisionModalProps) {
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen || !approval || !decision) {
    return null;
  }

  const copy = COPY[decision];

  function handleClose() {
    setNotes('');
    setError(null);
    onClose();
  }

  async function handleConfirm() {
    if (!approval || !decision) {
      return;
    }
    setIsSubmitting(true);
    setError(null);

    const res = await apiRequest(`/approvals/${approval.id}/${decision}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes: notes.trim() || undefined }),
    });

    setIsSubmitting(false);

    if (res.status === 409) {
      setNotes('');
      onConflict(approval.id);
      onClose();
      return;
    }

    if (!res.ok) {
      setError(GENERIC_ERROR_MESSAGE);
      return;
    }

    const updated = (await res.json()) as ApprovalRow;
    setNotes('');
    setError(null);
    onResolved(updated);
    onClose();
  }

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="approval-decision-heading" className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-lg">
      <div className="w-full max-w-md rounded-md border border-[var(--border-soft)] bg-[var(--surface-1)] p-lg shadow-card-strong">
        <h2 id="approval-decision-heading" className="text-block-title font-semibold text-[var(--text-primary)]">
          {copy.heading}
        </h2>
        <p className="mt-sm text-body text-[var(--text-secondary)]">
          {approval.playerName} — {approval.amount} {approval.paymentType}
        </p>

        <div className="mt-md flex flex-col gap-xxs">
          <label htmlFor="approval-decision-notes" className="text-body text-[var(--text-secondary)]">
            Notes (optional)
          </label>
          <textarea
            id="approval-decision-notes"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            className="rounded-sm border border-[var(--border-soft)] bg-[var(--surface-0)] p-sm text-body text-[var(--text-primary)] outline-none focus:border-[var(--brand-primary)]"
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
            disabled={isSubmitting}
            className={`rounded-sm p-sm text-body font-semibold shadow-button-primary disabled:opacity-60 ${copy.confirmClass}`}
          >
            {isSubmitting ? 'Submitting…' : copy.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
