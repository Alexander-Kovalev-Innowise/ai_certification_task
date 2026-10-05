'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

import { apiRequest } from '../../lib/api/apiClient';
import { parseApiErrorBody } from '../../lib/api/apiError';
import { inviteCoachSchema, type InviteCoachFormValues } from '../../lib/schemas/inviteCoachSchema';

// api §4.2 POST /coaches/invite — `201 InviteCoachResponseDto`.
export interface InviteCoachResult {
  id?: string;
  shareLinkCode: string;
  expiresAt: string | null;
  status: 'PENDING';
}

export interface InviteCoachModalProps {
  isOpen: boolean;
  onClose: () => void;
  onInvited?: (result: InviteCoachResult) => void;
}

const GENERIC_ERROR_MESSAGE = 'Something went wrong sending the invite. Please try again.';

// POST /coaches/invite 409s (BR-003 enforced at INVITE time).
const ERROR_MESSAGES: Record<string, string> = {
  COACH_ALREADY_ASSIGNED: 'This coach is already assigned to another trainer, so they cannot be invited.',
  COACH_ALREADY_ON_ROSTER: 'This coach is already on your roster.',
};

const INPUT_CLASSNAME =
  'w-full min-w-0';

// fe §4.4 — InviteCoachModal: `POST /coaches/invite`
// `{ email: string, name?: string, message?: string }` (api §4.2, FR-060).
// Resending an existing invite is NOT done here any more - the roster calls
// `POST /coaches/invites/:id/resend` directly. Task 13.2.
export function InviteCoachModal({ isOpen, onClose, onInvited }: InviteCoachModalProps) {
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<InviteCoachFormValues>({
    resolver: zodResolver(inviteCoachSchema),
    mode: 'onTouched',
    defaultValues: { email: '', name: '', message: '' },
  });

  if (!isOpen) {
    return null;
  }

  function handleClose() {
    reset();
    setFormError(null);
    onClose();
  }

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);

    const body: { email: string; name?: string; message?: string } = { email: values.email };
    if (values.name.trim()) {
      body.name = values.name.trim();
    }
    if (values.message.trim()) {
      body.message = values.message.trim();
    }

    const res = await apiRequest('/coaches/invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const body = await parseApiErrorBody(res);
      setFormError((res.status === 409 && body && ERROR_MESSAGES[body.errorCode]) || GENERIC_ERROR_MESSAGE);
      return;
    }

    const result = (await res.json()) as InviteCoachResult;
    reset();
    setFormError(null);
    onInvited?.(result);
    onClose();
  });

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="invite-coach-heading" className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-lg">
      <div className="w-full max-w-[28rem] rounded-md border border-border-soft bg-surface-1 p-lg shadow-card-strong">
        <h2 id="invite-coach-heading" className="text-block-title font-semibold text-text-primary">
          Invite a coach
        </h2>

        <form onSubmit={onSubmit} noValidate className="mt-md flex flex-col gap-md">
          <div className="flex flex-col gap-xxs">
            <label htmlFor="invite-coach-email" className="field-label">
              Email
            </label>
            <input
              id="invite-coach-email"
              type="email"
              placeholder="coach@example.com"
              autoComplete="off"
              className={INPUT_CLASSNAME}
              aria-invalid={!!errors.email}
              aria-describedby={errors.email ? 'invite-coach-email-error' : undefined}
              {...register('email')}
            />
            {errors.email && (
              <p id="invite-coach-email-error" role="alert" className="text-caption text-danger">
                {errors.email.message}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-xxs">
            <label htmlFor="invite-coach-name" className="field-label">
              Name (optional)
            </label>
            <input
              id="invite-coach-name"
              placeholder="Cam Coach"
              autoComplete="off"
              className={INPUT_CLASSNAME}
              aria-invalid={!!errors.name}
              aria-describedby={errors.name ? 'invite-coach-name-error' : undefined}
              {...register('name')}
            />
            {errors.name && (
              <p id="invite-coach-name-error" role="alert" className="text-caption text-danger">
                {errors.name.message}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-xxs">
            <label htmlFor="invite-coach-message" className="field-label">
              Message (optional)
            </label>
            <textarea
              id="invite-coach-message"
              rows={3}
              placeholder="Hi Cam, I'd love for you to join our team as a coach."
              autoComplete="off"
              className={INPUT_CLASSNAME}
              aria-invalid={!!errors.message}
              aria-describedby={errors.message ? 'invite-coach-message-error' : undefined}
              {...register('message')}
            />
            {errors.message && (
              <p id="invite-coach-message-error" role="alert" className="text-caption text-danger">
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
            <button type="button" onClick={handleClose} className="btn btn-ghost">
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="btn btn-primary"
            >
              {isSubmitting ? 'Sending…' : 'Send invite'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
