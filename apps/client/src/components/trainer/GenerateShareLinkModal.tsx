'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

import { apiRequest } from '../../lib/api/apiClient';
import { parseApiErrorBody } from '../../lib/api/apiError';
import { createShareLinkSchema, type CreateShareLinkFormValues } from '../../lib/schemas/createShareLinkSchema';

// api §4.4 POST /share-links — `201 ShareLinkCreatedResponseDto`.
export interface GenerateShareLinkResult {
  id: string;
  code: string;
  type: 'PLAYER_STATIC' | 'COACH_UNIQUE';
  joinUrl: string;
  expiresAt: string | null;
  status: 'ACTIVE';
}

export interface GenerateShareLinkModalProps {
  isOpen: boolean;
  onClose: () => void;
  onGenerated?: (result: GenerateShareLinkResult) => void;
}

const GENERIC_ERROR_MESSAGE = 'Something went wrong generating the link. Please try again.';

const INPUT_CLASSNAME =
  'rounded-sm border border-[var(--border-soft)] bg-[var(--surface-0)] p-sm text-body text-[var(--text-primary)] outline-none focus:border-[var(--brand-primary)]';

// fe §4.4 — GenerateShareLinkModal: type toggle Player-Static/Coach-Unique,
// conditional `targetEmail` field (mirrors `CreateShareLinkDto`'s
// `@ValidateIf`), posts `POST /share-links` (api §4.4, FR-023).
// PLAYER_STATIC generates an unlimited-use, no-expiry link (BR-006);
// COACH_UNIQUE generates a single-use, 7-day-expiry link addressed to
// `targetEmail`. Task 13.3.
export function GenerateShareLinkModal({ isOpen, onClose, onGenerated }: GenerateShareLinkModalProps) {
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<CreateShareLinkFormValues>({
    resolver: zodResolver(createShareLinkSchema),
    defaultValues: { type: 'PLAYER_STATIC', targetEmail: '' },
  });

  const type = watch('type');

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

    const body: { type: CreateShareLinkFormValues['type']; targetEmail?: string } = { type: values.type };
    if (values.type === 'COACH_UNIQUE' && values.targetEmail) {
      body.targetEmail = values.targetEmail;
    }

    const res = await apiRequest('/share-links', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      await parseApiErrorBody(res);
      setFormError(GENERIC_ERROR_MESSAGE);
      return;
    }

    const result = (await res.json()) as GenerateShareLinkResult;
    reset();
    setFormError(null);
    onGenerated?.(result);
    onClose();
  });

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="generate-share-link-heading" className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-lg">
      <div className="w-full max-w-md rounded-md border border-[var(--border-soft)] bg-[var(--surface-1)] p-lg shadow-card-strong">
        <h2 id="generate-share-link-heading" className="text-block-title font-semibold text-[var(--text-primary)]">
          Generate share link
        </h2>

        <form onSubmit={onSubmit} noValidate className="mt-md flex flex-col gap-md">
          <fieldset className="flex flex-col gap-xxs">
            <legend className="text-body text-[var(--text-secondary)]">Link type</legend>
            <label className="flex items-center gap-sm text-body text-[var(--text-primary)]">
              <input type="radio" value="PLAYER_STATIC" {...register('type')} />
              Player (unlimited, no expiry)
            </label>
            <label className="flex items-center gap-sm text-body text-[var(--text-primary)]">
              <input type="radio" value="COACH_UNIQUE" {...register('type')} />
              Coach (single-use, expires in 7 days)
            </label>
          </fieldset>

          {type === 'COACH_UNIQUE' && (
            <div className="flex flex-col gap-xxs">
              <label htmlFor="generate-share-link-email" className="text-body text-[var(--text-secondary)]">
                Coach email
              </label>
              <input
                id="generate-share-link-email"
                type="email"
                className={INPUT_CLASSNAME}
                aria-invalid={!!errors.targetEmail}
                aria-describedby={errors.targetEmail ? 'generate-share-link-email-error' : undefined}
                {...register('targetEmail')}
              />
              {errors.targetEmail && (
                <p id="generate-share-link-email-error" role="alert" className="text-caption text-[var(--danger)]">
                  {errors.targetEmail.message}
                </p>
              )}
            </div>
          )}

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
              {isSubmitting ? 'Generating…' : 'Generate'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
