'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

import { apiRequest } from '../../lib/api/apiClient';
import { requestInfoSchema } from '../../lib/schemas/requestInfoSchema';
import { resolveApprovalSchema, type ResolveApprovalFormValues } from '../../lib/schemas/resolveApprovalSchema';

import type { ApprovalRow } from './ApprovalCard';

export interface ApprovalDecisionModalProps {
  isOpen: boolean;
  approval: ApprovalRow | null;
  decision: 'approve' | 'deny' | 'request-info' | null;
  onClose: () => void;
  onResolved: (updated: ApprovalRow) => void;
  /** api §4.6/§9.1 — a `409` means the 5-minute expiry sweep beat this decision; re-render as EXPIRED, not a raw conflict error. */
  onConflict: (approvalId: string) => void;
}

const GENERIC_ERROR_MESSAGE = "Something went wrong recording your decision. Please try again.";

const COPY = {
  approve: { heading: 'Approve request', confirmLabel: 'Confirm approval', confirmClass: 'btn-primary' },
  deny: { heading: 'Deny request', confirmLabel: 'Confirm denial', confirmClass: 'btn-danger' },
  'request-info': { heading: 'Request more info', confirmLabel: 'Send question', confirmClass: 'btn-primary' },
} as const;

// fe §9.1 — ApprovalDecisionModal: `/approvals`' approve/deny confirmation,
// notes field, `POST /approvals/:id/approve|/deny` (api §4.6, `{ notes? }`).
// A `409 CONFLICT` — the `ApprovalExpiryJob` cron won the race against this
// click — calls `onConflict` so the page can re-fetch and re-render the
// single approval as `EXPIRED` with a toast, rather than surfacing a raw
// conflict error (§9.1's own framing). Task 14.8.
export function ApprovalDecisionModal({ isOpen, approval, decision, onClose, onResolved, onConflict }: ApprovalDecisionModalProps) {
  const [error, setError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    setError: setFieldError,
    formState: { errors, isSubmitting },
  } = useForm<ResolveApprovalFormValues>({
    resolver: zodResolver(resolveApprovalSchema),
    mode: 'onTouched',
    defaultValues: { notes: '' },
  });

  if (!isOpen || !approval || !decision) {
    return null;
  }

  const copy = COPY[decision];

  function handleClose() {
    reset();
    setError(null);
    onClose();
  }

  const handleConfirm = handleSubmit(async (values) => {
    if (!approval || !decision) {
      return;
    }
    setError(null);

    // "Request more info" keeps the request PENDING and emails the child the
    // question — so the message is required (`{ message }`), unlike the
    // optional `{ notes }` of approve/deny.
    let body: Record<string, string | undefined>;
    if (decision === 'request-info') {
      const parsed = requestInfoSchema.safeParse({ message: values.notes });
      if (!parsed.success) {
        setFieldError('notes', { type: 'validate', message: parsed.error.issues[0]?.message ?? 'Write a short question for your child.' });
        return;
      }
      body = { message: parsed.data.message };
    } else {
      body = { notes: values.notes.trim() || undefined };
    }

    const res = await apiRequest(`/approvals/${approval.id}/${decision}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (res.status === 409) {
      reset();
      onConflict(approval.id);
      onClose();
      return;
    }

    if (!res.ok) {
      setError(GENERIC_ERROR_MESSAGE);
      return;
    }

    const updated = (await res.json()) as ApprovalRow;
    reset();
    setError(null);
    onResolved(updated);
    onClose();
  });

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="approval-decision-heading" className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-lg">
      <div className="w-full max-w-[28rem] rounded-md border border-border-soft bg-surface-1 p-lg shadow-card-strong">
        <h2 id="approval-decision-heading" className="text-block-title font-semibold text-text-primary">
          {copy.heading}
        </h2>
        <p className="mt-sm text-body text-text-secondary">
          {approval.playerName} — {approval.amount} {approval.paymentType}
        </p>

        <div className="mt-md flex flex-col gap-xxs">
          <label htmlFor="approval-decision-notes" className="field-label">
            {decision === 'request-info' ? 'Your question' : 'Notes (optional)'}
          </label>
          <textarea
            id="approval-decision-notes"
            rows={3}
            placeholder={
              decision === 'request-info'
                ? 'What would you like to know? e.g. “Which clinic is this for?”'
                : 'Add a note for the player or trainer, e.g. “Sounds good — have fun!”'
            }
            autoComplete="off"
            aria-invalid={!!errors.notes}
            aria-describedby={errors.notes ? 'approval-decision-notes-error' : undefined}
            className="w-full min-w-0"
            {...register('notes')}
          />
          {errors.notes && (
            <p id="approval-decision-notes-error" role="alert" className="text-caption text-danger">
              {errors.notes.message}
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
            disabled={isSubmitting}
            className={`btn ${copy.confirmClass}`}
          >
            {isSubmitting ? 'Submitting…' : copy.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
