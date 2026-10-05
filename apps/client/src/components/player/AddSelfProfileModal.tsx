'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

import { apiRequest } from '../../lib/api/apiClient';
import { addSelfProfileSchema, SELF_GENDERS, type AddSelfProfileFormValues } from '../../lib/schemas/addSelfProfileSchema';

export interface AddSelfProfileModalProps {
  isOpen: boolean;
  /** Pre-filled from the signed-in account, e.g. "Priya Parent". */
  defaultName?: string;
  onClose: () => void;
  onCreated: () => void;
}

const ALREADY_EXISTS_MESSAGE = 'You already have a player profile of your own.';
const GENERIC_ERROR = 'Something went wrong creating your profile. Please try again.';

// "Add myself as a player" — creates the guardian's own `isSelf` player
// profile (`POST /player-profiles` with `isSelf: true`), allowed once while
// none exists. Separate from ChildProfileForm (the 1-18 child age rule does
// not apply here).
export function AddSelfProfileModal({ isOpen, defaultName = '', onClose, onCreated }: AddSelfProfileModalProps) {
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<AddSelfProfileFormValues>({
    resolver: zodResolver(addSelfProfileSchema),
    mode: 'onTouched',
    defaultValues: { name: defaultName, dateOfBirth: '', gender: '' as AddSelfProfileFormValues['gender'] },
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
    const res = await apiRequest('/player-profiles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...values, isSelf: true }),
    });
    if (res.status === 409) {
      setFormError(ALREADY_EXISTS_MESSAGE);
      return;
    }
    if (!res.ok) {
      setFormError(GENERIC_ERROR);
      return;
    }
    reset();
    onCreated();
    onClose();
  });

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-self-heading"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-lg"
    >
      <div className="max-h-full w-full max-w-[28rem] overflow-y-auto rounded-md border border-border-soft bg-surface-1 p-lg shadow-card-strong">
        <h2 id="add-self-heading" className="text-block-title font-semibold text-text-primary">
          Add myself as a player
        </h2>

        <form onSubmit={onSubmit} noValidate className="mt-md flex flex-col gap-md">
          <div className="flex flex-col gap-xxs">
            <label htmlFor="add-self-name" className="field-label">
              Name
            </label>
            <input
              id="add-self-name"
              placeholder="Priya Parent"
              autoComplete="name"
              className="w-full min-w-0"
              aria-invalid={!!errors.name}
              aria-describedby={errors.name ? 'add-self-name-error' : undefined}
              {...register('name')}
            />
            {errors.name && (
              <p id="add-self-name-error" role="alert" className="text-caption text-danger">
                {errors.name.message}
              </p>
            )}
          </div>

          <div className="flex flex-wrap gap-md">
            <div className="flex min-w-0 flex-[1_1_11rem] flex-col gap-xxs">
              <label htmlFor="add-self-dob" className="field-label">
                Date of birth
              </label>
              <input
                id="add-self-dob"
                type="date"
                autoComplete="bday"
                className="w-full min-w-0"
                aria-invalid={!!errors.dateOfBirth}
                aria-describedby={errors.dateOfBirth ? 'add-self-dob-error' : undefined}
                {...register('dateOfBirth')}
              />
              {errors.dateOfBirth && (
                <p id="add-self-dob-error" role="alert" className="text-caption text-danger">
                  {errors.dateOfBirth.message}
                </p>
              )}
            </div>

            <div className="flex min-w-0 flex-[1_1_11rem] flex-col gap-xxs">
              <label htmlFor="add-self-gender" className="field-label">
                Gender
              </label>
              <select
                id="add-self-gender"
                className="w-full min-w-0"
                aria-invalid={!!errors.gender}
                aria-describedby={errors.gender ? 'add-self-gender-error' : undefined}
                {...register('gender')}
              >
                <option value="" disabled>
                  Select…
                </option>
                {SELF_GENDERS.map((gender) => (
                  <option key={gender} value={gender}>
                    {gender.replace(/_/g, ' ').toLowerCase()}
                  </option>
                ))}
              </select>
              {errors.gender && (
                <p id="add-self-gender-error" role="alert" className="text-caption text-danger">
                  {errors.gender.message}
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
            <button type="submit" disabled={isSubmitting} className="btn btn-primary">
              {isSubmitting ? 'Adding…' : 'Add myself'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
