'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

import { apiRequest } from '../../lib/api/apiClient';
import { parseApiErrorBody } from '../../lib/api/apiError';
import { requestOverrideChangeSchema, type RequestOverrideChangeFormValues } from '../../lib/schemas/requestOverrideChangeSchema';
import { Modal } from '../shared/Modal';

export interface RequestOverrideChangeModalProps {
  coachProfileId: string;
  overrideId: string;
  /** Human label of the session the request is about (shown in the heading). */
  sessionLabel: string | null;
  onClose: () => void;
  onSent: () => void;
}

const GENERIC_ERROR = 'Could not send your request. Please try again.';

// US-01.10 "request change": the coach asks the trainer to change an assignment
// that conflicts with their availability. `POST /coaches/:id/availability/
// overrides/:oid/request-change { message }` - the server emails the trainer.
// Rendered only while open (mount == open), per the shared Modal contract.
export function RequestOverrideChangeModal({ coachProfileId, overrideId, sessionLabel, onClose, onSent }: RequestOverrideChangeModalProps) {
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<RequestOverrideChangeFormValues>({
    resolver: zodResolver(requestOverrideChangeSchema),
    mode: 'onTouched',
    defaultValues: { message: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    const res = await apiRequest(`/coaches/${coachProfileId}/availability/overrides/${overrideId}/request-change`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: values.message }),
    });
    if (!res.ok) {
      const body = await parseApiErrorBody(res);
      setFormError(body?.errorCode === 'OVERRIDE_ALREADY_ACKNOWLEDGED' ? 'You already accepted this assignment.' : GENERIC_ERROR);
      return;
    }
    onSent();
  });

  return (
    <Modal
      labelledBy="request-change-heading"
      describedBy="request-change-description"
      onClose={onClose}
      closeOnBackdrop={false}
      className="w-full max-w-[28rem] rounded-md border border-border-soft bg-surface-1 p-lg shadow-card-strong"
    >
      <h2 id="request-change-heading" className="text-block-title font-semibold text-text-primary">
        Request a change
      </h2>
      <p id="request-change-description" className="mt-xs text-caption text-text-secondary">
        Tell your trainer what you would like changed{sessionLabel ? ` about "${sessionLabel}"` : ''}. They will be notified by email.
      </p>

      <form onSubmit={onSubmit} noValidate className="mt-md flex flex-col gap-md">
        <div className="flex flex-col gap-xxs">
          <label htmlFor="request-change-message" className="field-label">
            Message
          </label>
          <textarea
            id="request-change-message"
            rows={4}
            maxLength={600}
            placeholder="e.g. I cannot make Tuesday evenings - could this move to Wednesday?"
            className="w-full min-w-0"
            aria-invalid={!!errors.message}
            aria-describedby={errors.message ? 'request-change-message-error' : undefined}
            {...register('message')}
          />
          {errors.message && (
            <p id="request-change-message-error" role="alert" className="text-caption text-danger">
              {errors.message.message}
            </p>
          )}
        </div>

        {formError && (
          <p role="alert" className="text-body text-danger">
            {formError}
          </p>
        )}

        <div className="mt-sm flex justify-end gap-sm">
          <button type="button" onClick={onClose} className="btn btn-ghost">
            Cancel
          </button>
          <button type="submit" disabled={isSubmitting} className="btn btn-primary">
            {isSubmitting ? 'Sending…' : 'Send request'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
