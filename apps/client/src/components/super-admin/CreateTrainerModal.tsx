'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

import { apiRequest } from '../../lib/api/apiClient';
import { parseApiErrorBody } from '../../lib/api/apiError';
import { createTrainerSchema, type CreateTrainerFormValues } from '../../lib/schemas/createTrainerSchema';

// api §4.1 POST /trainers — `201 TrainerResponseDto`.
export interface CreateTrainerResult {
  id: string;
  userId: string;
  businessName: string;
  email: string;
  status: string;
  createdAt: string;
}

export interface CreateTrainerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated?: (trainer: CreateTrainerResult) => void;
}

const DUPLICATE_EMAIL_MESSAGE = 'A user with this email already exists.';
const GENERIC_ERROR_MESSAGE = 'Something went wrong creating the trainer. Please try again.';

const INPUT_CLASSNAME =
  'rounded-sm border border-[var(--border-soft)] bg-[var(--surface-0)] p-sm text-body text-[var(--text-primary)] outline-none focus:border-[var(--brand-primary)]';

// fe §4.3/§11.1 — CreateTrainerModal: posts `CreateTrainerDto {businessName,
// firstName, lastName, email, phone}` (api §4.1) — the resolved
// two-name-field shape, not a single "Trainer Name" input. Only Super Admin
// account-creation flow in Epic-01 (api §8.5 — `POST /users` doesn't exist).
// Task 12.4.
export function CreateTrainerModal({ isOpen, onClose, onCreated }: CreateTrainerModalProps) {
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CreateTrainerFormValues>({ resolver: zodResolver(createTrainerSchema) });

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

    const res = await apiRequest('/trainers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(values),
    });

    if (!res.ok) {
      if (res.status === 409) {
        setFormError(DUPLICATE_EMAIL_MESSAGE);
      } else {
        await parseApiErrorBody(res);
        setFormError(GENERIC_ERROR_MESSAGE);
      }
      return;
    }

    const trainer = (await res.json()) as CreateTrainerResult;
    reset();
    setFormError(null);
    onCreated?.(trainer);
    onClose();
  });

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-trainer-heading"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-lg"
    >
      <div className="w-full max-w-md rounded-md border border-[var(--border-soft)] bg-[var(--surface-1)] p-lg shadow-card-strong">
        <h2 id="create-trainer-heading" className="text-block-title font-semibold text-[var(--text-primary)]">
          Create Trainer
        </h2>

        <form onSubmit={onSubmit} noValidate className="mt-md flex flex-col gap-md">
          <div className="flex flex-col gap-xxs">
            <label htmlFor="create-trainer-business-name" className="text-body text-[var(--text-secondary)]">
              Business name
            </label>
            <input
              id="create-trainer-business-name"
              className={INPUT_CLASSNAME}
              aria-invalid={!!errors.businessName}
              aria-describedby={errors.businessName ? 'create-trainer-business-name-error' : undefined}
              {...register('businessName')}
            />
            {errors.businessName && (
              <p id="create-trainer-business-name-error" role="alert" className="text-caption text-[var(--danger)]">
                {errors.businessName.message}
              </p>
            )}
          </div>

          <div className="flex gap-md">
            <div className="flex flex-1 flex-col gap-xxs">
              <label htmlFor="create-trainer-first-name" className="text-body text-[var(--text-secondary)]">
                First name
              </label>
              <input
                id="create-trainer-first-name"
                className={INPUT_CLASSNAME}
                aria-invalid={!!errors.firstName}
                aria-describedby={errors.firstName ? 'create-trainer-first-name-error' : undefined}
                {...register('firstName')}
              />
              {errors.firstName && (
                <p id="create-trainer-first-name-error" role="alert" className="text-caption text-[var(--danger)]">
                  {errors.firstName.message}
                </p>
              )}
            </div>

            <div className="flex flex-1 flex-col gap-xxs">
              <label htmlFor="create-trainer-last-name" className="text-body text-[var(--text-secondary)]">
                Last name
              </label>
              <input
                id="create-trainer-last-name"
                className={INPUT_CLASSNAME}
                aria-invalid={!!errors.lastName}
                aria-describedby={errors.lastName ? 'create-trainer-last-name-error' : undefined}
                {...register('lastName')}
              />
              {errors.lastName && (
                <p id="create-trainer-last-name-error" role="alert" className="text-caption text-[var(--danger)]">
                  {errors.lastName.message}
                </p>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-xxs">
            <label htmlFor="create-trainer-email" className="text-body text-[var(--text-secondary)]">
              Email
            </label>
            <input
              id="create-trainer-email"
              type="email"
              className={INPUT_CLASSNAME}
              aria-invalid={!!errors.email}
              aria-describedby={errors.email ? 'create-trainer-email-error' : undefined}
              {...register('email')}
            />
            {errors.email && (
              <p id="create-trainer-email-error" role="alert" className="text-caption text-[var(--danger)]">
                {errors.email.message}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-xxs">
            <label htmlFor="create-trainer-phone" className="text-body text-[var(--text-secondary)]">
              Phone
            </label>
            <input
              id="create-trainer-phone"
              type="tel"
              className={INPUT_CLASSNAME}
              aria-invalid={!!errors.phone}
              aria-describedby={errors.phone ? 'create-trainer-phone-error' : undefined}
              {...register('phone')}
            />
            {errors.phone && (
              <p id="create-trainer-phone-error" role="alert" className="text-caption text-[var(--danger)]">
                {errors.phone.message}
              </p>
            )}
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
              {isSubmitting ? 'Creating…' : 'Create trainer'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
