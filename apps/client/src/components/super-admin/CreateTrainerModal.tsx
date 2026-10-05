'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';

import { apiRequest } from '../../lib/api/apiClient';
import { parseApiErrorBody } from '../../lib/api/apiError';
import { createTrainerSchema, type CreateTrainerFormValues } from '../../lib/schemas/createTrainerSchema';
import { PhoneInput } from '../shared/PhoneInput';

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
  'w-full min-w-0';

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
    control,
    formState: { errors, isSubmitting },
  } = useForm<CreateTrainerFormValues>({
    resolver: zodResolver(createTrainerSchema),
    mode: 'onTouched',
    defaultValues: { businessName: '', firstName: '', lastName: '', email: '', phone: '' },
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
      <div className="max-h-full w-full max-w-[28rem] overflow-y-auto rounded-md border border-border-soft bg-surface-1 p-lg shadow-card-strong">
        <h2 id="create-trainer-heading" className="text-block-title font-semibold text-text-primary">
          Create Trainer
        </h2>

        <form onSubmit={onSubmit} noValidate className="mt-md flex flex-col gap-md">
          <div className="flex flex-col gap-xxs">
            <label htmlFor="create-trainer-business-name" className="field-label">
              Business name
            </label>
            <input
              id="create-trainer-business-name"
              placeholder="Elite Basketball Academy"
              autoComplete="organization"
              className={INPUT_CLASSNAME}
              aria-invalid={!!errors.businessName}
              aria-describedby={errors.businessName ? 'create-trainer-business-name-error' : undefined}
              {...register('businessName')}
            />
            {errors.businessName && (
              <p id="create-trainer-business-name-error" role="alert" className="text-caption text-danger">
                {errors.businessName.message}
              </p>
            )}
          </div>

          <div className="flex flex-wrap gap-md">
            <div className="flex min-w-0 flex-[1_1_11rem] flex-col gap-xxs">
              <label htmlFor="create-trainer-first-name" className="field-label">
                First name
              </label>
              <input
                id="create-trainer-first-name"
                placeholder="John"
                autoComplete="given-name"
                className={INPUT_CLASSNAME}
                aria-invalid={!!errors.firstName}
                aria-describedby={errors.firstName ? 'create-trainer-first-name-error' : undefined}
                {...register('firstName')}
              />
              {errors.firstName && (
                <p id="create-trainer-first-name-error" role="alert" className="text-caption text-danger">
                  {errors.firstName.message}
                </p>
              )}
            </div>

            <div className="flex min-w-0 flex-[1_1_11rem] flex-col gap-xxs">
              <label htmlFor="create-trainer-last-name" className="field-label">
                Last name
              </label>
              <input
                id="create-trainer-last-name"
                placeholder="Smith"
                autoComplete="family-name"
                className={INPUT_CLASSNAME}
                aria-invalid={!!errors.lastName}
                aria-describedby={errors.lastName ? 'create-trainer-last-name-error' : undefined}
                {...register('lastName')}
              />
              {errors.lastName && (
                <p id="create-trainer-last-name-error" role="alert" className="text-caption text-danger">
                  {errors.lastName.message}
                </p>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-xxs">
            <label htmlFor="create-trainer-email" className="field-label">
              Email
            </label>
            <input
              id="create-trainer-email"
              type="email"
              placeholder="trainer@example.com"
              autoComplete="email"
              className={INPUT_CLASSNAME}
              aria-invalid={!!errors.email}
              aria-describedby={errors.email ? 'create-trainer-email-error' : undefined}
              {...register('email')}
            />
            {errors.email && (
              <p id="create-trainer-email-error" role="alert" className="text-caption text-danger">
                {errors.email.message}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-xxs">
            <label htmlFor="create-trainer-phone" className="field-label">
              Phone
            </label>
            <Controller
              control={control}
              name="phone"
              render={({ field }) => (
                <PhoneInput
                  id="create-trainer-phone"
                  value={field.value}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  className={INPUT_CLASSNAME}
                  aria-invalid={!!errors.phone}
                  aria-describedby={errors.phone ? 'create-trainer-phone-error' : undefined}
                />
              )}
            />
            {errors.phone && (
              <p id="create-trainer-phone-error" role="alert" className="text-caption text-danger">
                {errors.phone.message}
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
              {isSubmitting ? 'Creating…' : 'Create trainer'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
