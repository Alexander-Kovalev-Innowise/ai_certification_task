'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';

import { apiRequest } from '../../lib/api/apiClient';
import { parseApiErrorBody } from '../../lib/api/apiError';

import type { ResendTarget } from './CoachRosterTable';

// api §4.2 POST /coaches/invite — `201 InviteCoachResponseDto`.
export interface InviteCoachResult {
  shareLinkCode: string;
  expiresAt: string | null;
  status: 'PENDING';
}

interface InviteCoachFormValues {
  email: string;
  name: string;
  message: string;
}

export interface InviteCoachModalProps {
  isOpen: boolean;
  onClose: () => void;
  onInvited?: (result: InviteCoachResult) => void;
  /** Pre-fills email/name for the roster's "resend invite" action (Task 13.2's Do line). */
  resendTarget?: ResendTarget;
}

const GENERIC_ERROR_MESSAGE = 'Something went wrong sending the invite. Please try again.';

const INPUT_CLASSNAME =
  'rounded-sm border border-[var(--border-soft)] bg-[var(--surface-0)] p-sm text-body text-[var(--text-primary)] outline-none focus:border-[var(--brand-primary)]';

// fe §4.4 — InviteCoachModal: `POST /coaches/invite`
// `{ email: string, name?: string, message?: string }` (api §4.2, FR-060).
// Doubles as the roster's resend-on-expiry entry point via `resendTarget`
// (regenerates a fresh COACH_UNIQUE ShareLink for the same email/name — there
// is no dedicated resend endpoint, api §4.2's table lists exactly these
// three coach routes). Task 13.2.
//
// `resendTarget`-driven prefill deliberately relies on the caller
// remounting this component on open (`key={...}` at the `/coaches` page's
// call site) rather than an internal `useEffect` that calls `reset()` on
// `isOpen` — `react-hooks/set-state-in-effect` flags synchronizing state
// from a prop inside an Effect; a fresh mount via `key` gets the same
// prefill-on-open behavior from `useForm`'s own `defaultValues` alone.
export function InviteCoachModal({ isOpen, onClose, onInvited, resendTarget }: InviteCoachModalProps) {
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<InviteCoachFormValues>({
    defaultValues: { email: resendTarget?.email ?? '', name: resendTarget?.name ?? '', message: '' },
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
      await parseApiErrorBody(res);
      setFormError(GENERIC_ERROR_MESSAGE);
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
      <div className="w-full max-w-md rounded-md border border-[var(--border-soft)] bg-[var(--surface-1)] p-lg shadow-card-strong">
        <h2 id="invite-coach-heading" className="text-block-title font-semibold text-[var(--text-primary)]">
          Invite a coach
        </h2>

        <form onSubmit={onSubmit} noValidate className="mt-md flex flex-col gap-md">
          <div className="flex flex-col gap-xxs">
            <label htmlFor="invite-coach-email" className="text-body text-[var(--text-secondary)]">
              Email
            </label>
            <input
              id="invite-coach-email"
              type="email"
              className={INPUT_CLASSNAME}
              aria-invalid={!!errors.email}
              aria-describedby={errors.email ? 'invite-coach-email-error' : undefined}
              {...register('email', {
                required: 'Email is required.',
                pattern: { value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, message: 'Enter a valid email address.' },
              })}
            />
            {errors.email && (
              <p id="invite-coach-email-error" role="alert" className="text-caption text-[var(--danger)]">
                {errors.email.message}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-xxs">
            <label htmlFor="invite-coach-name" className="text-body text-[var(--text-secondary)]">
              Name (optional)
            </label>
            <input id="invite-coach-name" className={INPUT_CLASSNAME} {...register('name')} />
          </div>

          <div className="flex flex-col gap-xxs">
            <label htmlFor="invite-coach-message" className="text-body text-[var(--text-secondary)]">
              Message (optional)
            </label>
            <textarea id="invite-coach-message" className={INPUT_CLASSNAME} {...register('message')} />
          </div>

          {formError && (
            <p role="alert" className="text-body text-[var(--danger)]">
              {formError}
            </p>
          )}

          <div className="mt-sm flex justify-end gap-sm">
            <button type="button" onClick={handleClose} className="rounded-sm p-sm text-body text-[var(--text-secondary)]">
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="rounded-sm bg-[var(--brand-primary)] p-sm text-body font-semibold text-[#0D0D0D] shadow-button-primary disabled:opacity-60"
            >
              {isSubmitting ? 'Sending…' : 'Send invite'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
