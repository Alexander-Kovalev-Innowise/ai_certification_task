'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

import { apiRequest } from '../../lib/api/apiClient';
import { parseApiErrorBody } from '../../lib/api/apiError';
import {
  assignCoachSessionSchema,
  hhmmToMinutes,
  overrideReasonSchema,
  type AssignCoachSessionFormValues,
  type OverrideReasonFormValues,
} from '../../lib/schemas/assignCoachSessionSchema';
import { toast } from '../../lib/toast/toast';

export interface AssignCoachTarget {
  /** `CoachProfile.id`. */
  id: string;
  name: string;
}

export interface AssignCoachConflictModalProps {
  isOpen: boolean;
  coach: AssignCoachTarget | null;
  onClose: () => void;
}

type Phase = { step: 'form' } | { step: 'available' } | { step: 'conflict'; values: AssignCoachSessionFormValues };

const GENERIC_ERROR_MESSAGE = 'Something went wrong. Please try again.';
const INPUT_CLASSNAME = 'w-full min-w-0';

/** `YYYY-MM-DD` -> `Date.getDay()` (0 = Sunday), parsed as a LOCAL date so no timezone shift. */
function dayOfWeekFor(dateString: string): number {
  const [year, month, day] = dateString.split('-').map((part) => Number.parseInt(part, 10));
  return new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1).getDay();
}

// EPIC-02 STAND-IN: sessions/events do not exist until Epic-02, but
// `POST /coaches/:id/availability/override` needs an `eventId` (opaque UUID).
// Until the real event exists, the client mints one per assignment; the
// human-readable `sessionLabel` (+ date/time) is what the coach and the audit
// log actually show. Replace with the real event id when Epic-02 lands.
function generateStandInEventId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const random = Math.floor(Math.random() * 16);
    return (char === 'x' ? random : (random & 0x3) | 0x8).toString(16);
  });
}

function describeSession(values: AssignCoachSessionFormValues): string {
  const when = `${values.sessionDate} ${values.startTime}-${values.endTime}`;
  return values.sessionLabel ? `${values.sessionLabel} (${when})` : when;
}

// US-01.10 — AssignCoachConflictModal: the trainer enters a session date +
// time (+ optional label), `GET /coaches/:id/availability/check` says whether
// the coach's saved schedule covers it, and on a conflict the trainer may
// "Assign anyway" with a REQUIRED reason (`POST
// /coaches/:id/availability/override`, BR-012 - never blocks; the server logs
// event/coach/reason/overridden-by and emails the coach).
export function AssignCoachConflictModal({ isOpen, coach, onClose }: AssignCoachConflictModalProps) {
  const [phase, setPhase] = useState<Phase>({ step: 'form' });
  const [formError, setFormError] = useState<string | null>(null);

  const sessionForm = useForm<AssignCoachSessionFormValues>({
    resolver: zodResolver(assignCoachSessionSchema),
    mode: 'onTouched',
    defaultValues: { sessionLabel: '', sessionDate: '', startTime: '', endTime: '' },
  });
  const reasonForm = useForm<OverrideReasonFormValues>({
    resolver: zodResolver(overrideReasonSchema),
    mode: 'onTouched',
    defaultValues: { reason: '' },
  });

  if (!isOpen || !coach) {
    return null;
  }

  function handleClose() {
    sessionForm.reset();
    reasonForm.reset();
    setPhase({ step: 'form' });
    setFormError(null);
    onClose();
  }

  const onCheck = sessionForm.handleSubmit(async (values) => {
    setFormError(null);
    const params = new URLSearchParams({
      dayOfWeek: String(dayOfWeekFor(values.sessionDate)),
      startTime: String(hhmmToMinutes(values.startTime)),
      endTime: String(hhmmToMinutes(values.endTime)),
    });

    const res = await apiRequest(`/coaches/${coach.id}/availability/check?${params.toString()}`);
    if (!res.ok) {
      await parseApiErrorBody(res);
      setFormError(GENERIC_ERROR_MESSAGE);
      return;
    }

    const result = (await res.json()) as { hasConflict: boolean };
    setPhase(result.hasConflict ? { step: 'conflict', values } : { step: 'available' });
  });

  const onAssignAnyway = reasonForm.handleSubmit(async ({ reason }) => {
    if (phase.step !== 'conflict') {
      return;
    }
    setFormError(null);

    const res = await apiRequest(`/coaches/${coach.id}/availability/override`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventId: generateStandInEventId(),
        reason,
        sessionLabel: describeSession(phase.values),
      }),
    });
    if (!res.ok) {
      await parseApiErrorBody(res);
      setFormError(GENERIC_ERROR_MESSAGE);
      return;
    }

    toast.success(`${coach.name} was assigned anyway. The override was logged and the coach has been notified.`);
    handleClose();
  });

  const { errors: sessionErrors, isSubmitting: isChecking } = sessionForm.formState;
  const { errors: reasonErrors, isSubmitting: isAssigning } = reasonForm.formState;

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="assign-coach-heading" className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-lg">
      <div className="max-h-full w-full max-w-[30rem] overflow-y-auto rounded-md border border-border-soft bg-surface-1 p-lg shadow-card-strong">
        <h2 id="assign-coach-heading" className="text-block-title font-semibold text-text-primary">
          Assign {coach.name} to a session
        </h2>
        <p className="mt-xs text-caption text-text-secondary">Check the coach&apos;s saved schedule before you assign them.</p>

        {phase.step === 'form' && (
          <form onSubmit={onCheck} noValidate className="mt-md flex flex-col gap-md">
            <div className="flex flex-col gap-xxs">
              <label htmlFor="assign-coach-label" className="field-label">
                Session label (optional)
              </label>
              <input
                id="assign-coach-label"
                placeholder="U12 shooting drill"
                autoComplete="off"
                className={INPUT_CLASSNAME}
                aria-invalid={!!sessionErrors.sessionLabel}
                {...sessionForm.register('sessionLabel')}
              />
              {sessionErrors.sessionLabel && (
                <p role="alert" className="text-caption text-danger">
                  {sessionErrors.sessionLabel.message}
                </p>
              )}
            </div>

            <div className="flex flex-col gap-xxs">
              <label htmlFor="assign-coach-date" className="field-label">
                Session date
              </label>
              <input
                id="assign-coach-date"
                type="date"
                className={INPUT_CLASSNAME}
                aria-invalid={!!sessionErrors.sessionDate}
                {...sessionForm.register('sessionDate')}
              />
              {sessionErrors.sessionDate && (
                <p role="alert" className="text-caption text-danger">
                  {sessionErrors.sessionDate.message}
                </p>
              )}
            </div>

            <div className="flex flex-wrap gap-md">
              <div className="flex min-w-0 flex-[1_1_9rem] flex-col gap-xxs">
                <label htmlFor="assign-coach-start" className="field-label">
                  Start time
                </label>
                <input
                  id="assign-coach-start"
                  type="time"
                  className={INPUT_CLASSNAME}
                  aria-invalid={!!sessionErrors.startTime}
                  {...sessionForm.register('startTime')}
                />
                {sessionErrors.startTime && (
                  <p role="alert" className="text-caption text-danger">
                    {sessionErrors.startTime.message}
                  </p>
                )}
              </div>
              <div className="flex min-w-0 flex-[1_1_9rem] flex-col gap-xxs">
                <label htmlFor="assign-coach-end" className="field-label">
                  End time
                </label>
                <input
                  id="assign-coach-end"
                  type="time"
                  className={INPUT_CLASSNAME}
                  aria-invalid={!!sessionErrors.endTime}
                  {...sessionForm.register('endTime')}
                />
                {sessionErrors.endTime && (
                  <p role="alert" className="text-caption text-danger">
                    {sessionErrors.endTime.message}
                  </p>
                )}
              </div>
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
              <button type="submit" disabled={isChecking} className="btn btn-primary">
                {isChecking ? 'Checking…' : 'Check availability'}
              </button>
            </div>
          </form>
        )}

        {phase.step === 'available' && (
          <div className="mt-md flex flex-col gap-md">
            <p role="status" className="rounded-md bg-success/20 px-md py-sm text-body text-success">
              {coach.name} is available at this time per their schedule. You can go ahead and assign them.
            </p>
            <div className="flex justify-end gap-sm">
              <button type="button" onClick={() => setPhase({ step: 'form' })} className="btn btn-ghost">
                Check another time
              </button>
              <button type="button" onClick={handleClose} className="btn btn-primary">
                Done
              </button>
            </div>
          </div>
        )}

        {phase.step === 'conflict' && (
          <form onSubmit={onAssignAnyway} noValidate className="mt-md flex flex-col gap-md">
            <p role="alert" className="rounded-md bg-warning/20 px-md py-sm text-body text-warning">
              Coach {coach.name} is not available at this time per their schedule. Continue anyway?
            </p>

            <div className="flex flex-col gap-xxs">
              <label htmlFor="assign-coach-reason" className="field-label">
                Reason for assigning anyway
              </label>
              <textarea
                id="assign-coach-reason"
                rows={3}
                placeholder="Emergency cover - coach agreed by phone"
                autoComplete="off"
                className={INPUT_CLASSNAME}
                aria-invalid={!!reasonErrors.reason}
                aria-describedby={reasonErrors.reason ? 'assign-coach-reason-error' : undefined}
                {...reasonForm.register('reason')}
              />
              {reasonErrors.reason && (
                <p id="assign-coach-reason-error" role="alert" className="text-caption text-danger">
                  {reasonErrors.reason.message}
                </p>
              )}
              <p className="text-caption text-text-secondary">The reason is logged and emailed to the coach.</p>
            </div>

            {formError && (
              <p role="alert" className="text-body text-danger">
                {formError}
              </p>
            )}

            <div className="mt-sm flex justify-end gap-sm">
              <button type="button" onClick={() => setPhase({ step: 'form' })} className="btn btn-ghost">
                Back
              </button>
              <button type="submit" disabled={isAssigning} className="btn btn-primary">
                {isAssigning ? 'Assigning…' : 'Assign anyway'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
