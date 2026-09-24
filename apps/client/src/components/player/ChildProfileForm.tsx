'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

import { apiRequest } from '../../lib/api/apiClient';
import { parseApiErrorBody } from '../../lib/api/apiError';
import { createChildProfileSchema, GENDERS, type CreateChildProfileFormValues } from '../../lib/schemas/createChildProfileSchema';

// api §4.3 POST /player-profiles — `201 PlayerProfileResponseDto` (or `200`
// with the same shape plus `warning` on the FR-030 non-blocking duplicate
// branch, api §4.3's own note — never a hard 409 for this case).
export interface CreateChildProfileResult {
  id: string;
  name: string;
  dateOfBirth: string;
  gender: string;
  school?: string | null;
  photoUrl?: string | null;
  isSelf: boolean;
  trainerCount?: number;
  warning?: string;
}

export interface AvailableTrainerOption {
  id: string;
  businessName: string;
}

export interface ChildProfileFormProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated: (result: CreateChildProfileResult) => void;
  /** FR-032's "My Trainers" — the family's already-connected trainers, offered as the FR-031 checklist. */
  availableTrainers: AvailableTrainerOption[];
}

const GENERIC_ERROR_MESSAGE = 'Something went wrong adding this profile. Please try again.';

const INPUT_CLASSNAME =
  'rounded-sm border border-[var(--border-soft)] bg-[var(--surface-0)] p-sm text-body text-[var(--text-primary)] outline-none focus:border-[var(--brand-primary)]';

// fe §4.6 — ChildProfileForm: `/profiles`' "+Add Child" modal, posts
// `POST /player-profiles` (api §4.3, FR-030/FR-031). Create only — a
// `PlayerProfile` with `isSelf: true` is provisioned at registration, never
// through this endpoint, and editing an existing child's basics is
// `ProfileEditForm`'s job (Task 14.4, a different DTO/field set entirely:
// `UpdatePlayerProfileDto` has no `gender`/`dateOfBirth`/`trainerIds`).
// Task 14.3.
export function ChildProfileForm({ isOpen, onClose, onCreated, availableTrainers }: ChildProfileFormProps) {
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CreateChildProfileFormValues>({
    resolver: zodResolver(createChildProfileSchema),
    defaultValues: { name: '', dateOfBirth: '', gender: undefined, school: '', photoUrl: '', trainerIds: [] },
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

    const body: Record<string, unknown> = { name: values.name, dateOfBirth: values.dateOfBirth, gender: values.gender };
    if (values.school?.trim()) {
      body.school = values.school.trim();
    }
    if (values.photoUrl?.trim()) {
      body.photoUrl = values.photoUrl.trim();
    }
    if (values.trainerIds && values.trainerIds.length > 0) {
      body.trainerIds = values.trainerIds;
    }

    const res = await apiRequest('/player-profiles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      await parseApiErrorBody(res);
      setFormError(GENERIC_ERROR_MESSAGE);
      return;
    }

    const result = (await res.json()) as CreateChildProfileResult;
    reset();
    setFormError(null);
    onCreated(result);
    onClose();
  });

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="child-profile-heading" className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-lg">
      <div className="w-full max-w-md rounded-md border border-[var(--border-soft)] bg-[var(--surface-1)] p-lg shadow-card-strong">
        <h2 id="child-profile-heading" className="text-block-title font-semibold text-[var(--text-primary)]">
          Add a child profile
        </h2>

        <form onSubmit={onSubmit} noValidate className="mt-md flex flex-col gap-md">
          <div className="flex flex-col gap-xxs">
            <label htmlFor="child-profile-name" className="text-body text-[var(--text-secondary)]">
              Name
            </label>
            <input
              id="child-profile-name"
              className={INPUT_CLASSNAME}
              aria-invalid={!!errors.name}
              aria-describedby={errors.name ? 'child-profile-name-error' : undefined}
              {...register('name')}
            />
            {errors.name && (
              <p id="child-profile-name-error" role="alert" className="text-caption text-[var(--danger)]">
                {errors.name.message}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-xxs">
            <label htmlFor="child-profile-dob" className="text-body text-[var(--text-secondary)]">
              Date of birth
            </label>
            <input
              id="child-profile-dob"
              type="date"
              className={INPUT_CLASSNAME}
              aria-invalid={!!errors.dateOfBirth}
              aria-describedby={errors.dateOfBirth ? 'child-profile-dob-error' : undefined}
              {...register('dateOfBirth')}
            />
            {errors.dateOfBirth && (
              <p id="child-profile-dob-error" role="alert" className="text-caption text-[var(--danger)]">
                {errors.dateOfBirth.message}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-xxs">
            <label htmlFor="child-profile-gender" className="text-body text-[var(--text-secondary)]">
              Gender
            </label>
            <select
              id="child-profile-gender"
              className={INPUT_CLASSNAME}
              aria-invalid={!!errors.gender}
              aria-describedby={errors.gender ? 'child-profile-gender-error' : undefined}
              defaultValue=""
              {...register('gender')}
            >
              <option value="" disabled>
                Select…
              </option>
              {GENDERS.map((gender) => (
                <option key={gender} value={gender}>
                  {gender.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
            {errors.gender && (
              <p id="child-profile-gender-error" role="alert" className="text-caption text-[var(--danger)]">
                {errors.gender.message}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-xxs">
            <label htmlFor="child-profile-school" className="text-body text-[var(--text-secondary)]">
              School (optional)
            </label>
            <input id="child-profile-school" className={INPUT_CLASSNAME} {...register('school')} />
          </div>

          <div className="flex flex-col gap-xxs">
            <label htmlFor="child-profile-photo" className="text-body text-[var(--text-secondary)]">
              Photo URL (optional)
            </label>
            <input id="child-profile-photo" className={INPUT_CLASSNAME} {...register('photoUrl')} />
          </div>

          {availableTrainers.length > 0 && (
            <fieldset className="flex flex-col gap-xxs">
              <legend className="text-body text-[var(--text-secondary)]">Connect with trainers (optional)</legend>
              {availableTrainers.map((trainer) => (
                <label key={trainer.id} className="flex items-center gap-sm text-body text-[var(--text-primary)]">
                  <input type="checkbox" value={trainer.id} {...register('trainerIds')} />
                  {trainer.businessName}
                </label>
              ))}
            </fieldset>
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
              {isSubmitting ? 'Adding…' : 'Add child'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
