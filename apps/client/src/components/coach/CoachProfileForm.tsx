'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

import { apiRequest } from '../../lib/api/apiClient';
import { parseApiErrorBody } from '../../lib/api/apiError';
import { updateCoachProfileSchema, type UpdateCoachProfileFormValues } from '../../lib/schemas/updateCoachProfileSchema';

// api §4.2 UpdateCoachDto's self-fields branch — the exact subset a COACH
// caller may send (`status` is the owning-TRAINER-only field, never
// rendered here). Mirrors CoachProfileResponseDto's own shape.
export interface CoachProfileDetail {
  id: string;
  bio: string | null;
  credentials: string | null;
  certifications: string | null;
  publicProfile: boolean;
}

export interface CoachProfileFormProps {
  profile: CoachProfileDetail;
  onSaved: (updated: CoachProfileDetail) => void;
}

const GENERIC_SAVE_ERROR = "Some changes couldn't be saved. Please try again.";
const TOGGLE_SAVE_ERROR = "Some changes couldn't be saved. Please try again.";

const TEXTAREA_CLASSNAME =
  'w-full min-w-0';

function toDefaultValues(profile: CoachProfileDetail): UpdateCoachProfileFormValues {
  return {
    bio: profile.bio ?? '',
    credentials: profile.credentials ?? '',
    certifications: profile.certifications ?? '',
  };
}

// fe §4.5 — CoachProfileForm: `/profile`'s self-editor, `PATCH
// /coaches/:id` (api §4.2's self-fields branch). Two independent save paths
// on one component, deliberately not unified into a single submit:
//
// - bio/credentials/certifications: the established batch-submit pattern
//   (`ProfileEditForm`'s own "Save" button, react-hook-form defaults +
//   PATCH-on-submit).
// - publicProfile: fe §9.4 names this toggle explicitly as a low-stakes,
//   easily-reversible, high-frequency action that gets OPTIMISTIC treatment
//   ("toggling `publicProfile`" is fe §9.4's own worked example) — flip the
//   UI immediately, fire its own PATCH in the background, roll back + show
//   an inline error only if that PATCH fails. Firing it separately (rather
//   than bundling it into the Save button's body) is what keeps a slow
//   bio/credentials save from also delaying the toggle's "immediate"
//   feedback, and vice versa.
//
// Task 15.4.
export function CoachProfileForm({ profile, onSaved }: CoachProfileFormProps) {
  const [formError, setFormError] = useState<string | null>(null);
  const [publicProfile, setPublicProfile] = useState(profile.publicProfile);
  const [toggleError, setToggleError] = useState<string | null>(null);
  const [isToggling, setIsToggling] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<UpdateCoachProfileFormValues>({
    resolver: zodResolver(updateCoachProfileSchema),
    mode: 'onTouched',
    defaultValues: toDefaultValues(profile),
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);

    const body: Record<string, unknown> = {
      bio: values.bio.trim() || undefined,
      credentials: values.credentials.trim() || undefined,
      certifications: values.certifications.trim() || undefined,
    };

    const res = await apiRequest(`/coaches/${profile.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      await parseApiErrorBody(res);
      setFormError(GENERIC_SAVE_ERROR);
      return;
    }

    const updated = (await res.json()) as CoachProfileDetail;
    setFormError(null);
    onSaved(updated);
  });

  async function handleToggle() {
    const next = !publicProfile;
    setPublicProfile(next);
    setToggleError(null);
    setIsToggling(true);

    const res = await apiRequest(`/coaches/${profile.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ publicProfile: next }),
    });

    setIsToggling(false);

    if (!res.ok) {
      await parseApiErrorBody(res);
      setPublicProfile(!next);
      setToggleError(TOGGLE_SAVE_ERROR);
      return;
    }

    const updated = (await res.json()) as CoachProfileDetail;
    onSaved(updated);
  }

  return (
    <div className="flex flex-col gap-lg">
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-md">
        <div className="flex flex-col gap-xxs">
          <label htmlFor="coach-profile-bio" className="field-label">
            Bio
          </label>
          <textarea
            id="coach-profile-bio"
            placeholder="Tell players about your coaching background, style and what a session with you looks like."
            autoComplete="off"
            rows={4}
            className={TEXTAREA_CLASSNAME}
            aria-invalid={!!errors.bio}
            aria-describedby={errors.bio ? 'coach-profile-bio-error' : undefined}
            {...register('bio')}
          />
          {errors.bio && (
            <p id="coach-profile-bio-error" role="alert" className="text-caption text-danger">
              {errors.bio.message}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-xxs">
          <label htmlFor="coach-profile-credentials" className="field-label">
            Credentials
          </label>
          <textarea
            id="coach-profile-credentials"
            placeholder="e.g. Former D1 point guard, 10 years coaching youth basketball"
            autoComplete="off"
            rows={3}
            className={TEXTAREA_CLASSNAME}
            aria-invalid={!!errors.credentials}
            aria-describedby={errors.credentials ? 'coach-profile-credentials-error' : undefined}
            {...register('credentials')}
          />
          {errors.credentials && (
            <p id="coach-profile-credentials-error" role="alert" className="text-caption text-danger">
              {errors.credentials.message}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-xxs">
          <label htmlFor="coach-profile-certifications" className="field-label">
            Certifications
          </label>
          <textarea
            id="coach-profile-certifications"
            placeholder="e.g. USA Basketball Coach License, First Aid & CPR"
            autoComplete="off"
            rows={3}
            className={TEXTAREA_CLASSNAME}
            aria-invalid={!!errors.certifications}
            aria-describedby={errors.certifications ? 'coach-profile-certifications-error' : undefined}
            {...register('certifications')}
          />
          {errors.certifications && (
            <p id="coach-profile-certifications-error" role="alert" className="text-caption text-danger">
              {errors.certifications.message}
            </p>
          )}
        </div>

        {formError && (
          <p role="alert" className="text-body text-danger">
            {formError}
          </p>
        )}

        <div className="mt-sm flex justify-end">
          <button
            type="submit"
            disabled={isSubmitting}
            className="btn btn-primary"
          >
            {isSubmitting ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>

      <div className="flex flex-col gap-xxs rounded-md border border-border-soft p-md">
        <label htmlFor="coach-profile-public" className="flex items-center gap-sm text-body text-text-primary">
          <input id="coach-profile-public" type="checkbox" checked={publicProfile} disabled={isToggling} onChange={handleToggle} />
          Public profile
        </label>
        <p className="text-caption text-text-secondary">When on, your bio and credentials are visible on your trainer&apos;s public roster.</p>
        {toggleError && (
          <p role="alert" className="text-caption text-danger">
            {toggleError}
          </p>
        )}
      </div>
    </div>
  );
}
