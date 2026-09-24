'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';

import { apiRequest } from '../../lib/api/apiClient';
import { parseApiErrorBody } from '../../lib/api/apiError';

// api §4.3 PlayerProfileResponseDto — the slice ProfileEditForm reads/writes.
export interface PlayerProfileDetail {
  id: string;
  name: string;
  school: string | null;
  jerseyNumber: string | null;
  photoUrl: string | null;
  emergencyContact: Record<string, unknown> | null;
  allowChildTokenSpendWithoutApproval: boolean;
  isSelf: boolean;
}

export interface ProfileEditFormProps {
  profile: PlayerProfileDetail;
  /** `true` when the caller is the owning ADULT — `allowChildTokenSpendWithoutApproval` is a parental control, never rendered for a CHILD's own view (fe §7.2/api §4.3's CHILD_FIELD_NOT_EDITABLE pattern). */
  canEditGuardianFields: boolean;
  onSaved: (updated: PlayerProfileDetail) => void;
}

interface ProfileEditFormValues {
  name: string;
  school: string;
  jerseyNumber: string;
  photoUrl: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  allowChildTokenSpendWithoutApproval: boolean;
}

const GENERIC_SAVE_ERROR = "Some changes couldn't be saved. Please try again.";

const INPUT_CLASSNAME =
  'rounded-sm border border-[var(--border-soft)] bg-[var(--surface-0)] p-sm text-body text-[var(--text-primary)] outline-none focus:border-[var(--brand-primary)]';

function toDefaultValues(profile: PlayerProfileDetail): ProfileEditFormValues {
  const emergencyContact = profile.emergencyContact ?? {};
  return {
    name: profile.name,
    school: profile.school ?? '',
    jerseyNumber: profile.jerseyNumber ?? '',
    photoUrl: profile.photoUrl ?? '',
    emergencyContactName: typeof emergencyContact.name === 'string' ? emergencyContact.name : '',
    emergencyContactPhone: typeof emergencyContact.phone === 'string' ? emergencyContact.phone : '',
    allowChildTokenSpendWithoutApproval: profile.allowChildTokenSpendWithoutApproval,
  };
}

// fe §4.6/§7.2 — ProfileEditForm: `/profiles/[id]`'s basics editor, `PATCH
// /player-profiles/:id` (api §4.3 — name/school/jerseyNumber/photoUrl/
// emergencyContact, all editable by the owning adult or the child themself;
// `allowChildTokenSpendWithoutApproval` is the one field this component
// mirrors the server's CHILD-owner-only restriction on by simply not
// rendering it for a CHILD caller — rendering fewer fields, not validating
// more, per §7.2's own framing). A stale client/direct API call that sends
// it anyway still gets a real `403 CHILD_FIELD_NOT_EDITABLE` from the
// server; that's surfaced here as the generic toast §9.4 describes, never a
// silent drop. Task 14.4.
export function ProfileEditForm({ profile, canEditGuardianFields, onSaved }: ProfileEditFormProps) {
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ProfileEditFormValues>({ defaultValues: toDefaultValues(profile) });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);

    const body: Record<string, unknown> = {
      name: values.name,
      school: values.school.trim() || undefined,
      jerseyNumber: values.jerseyNumber.trim() || undefined,
      photoUrl: values.photoUrl.trim() || undefined,
    };
    if (values.emergencyContactName.trim() || values.emergencyContactPhone.trim()) {
      body.emergencyContact = { name: values.emergencyContactName.trim(), phone: values.emergencyContactPhone.trim() };
    }
    if (canEditGuardianFields) {
      body.allowChildTokenSpendWithoutApproval = values.allowChildTokenSpendWithoutApproval;
    }

    const res = await apiRequest(`/player-profiles/${profile.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      await parseApiErrorBody(res);
      setFormError(GENERIC_SAVE_ERROR);
      return;
    }

    const updated = (await res.json()) as PlayerProfileDetail;
    setFormError(null);
    onSaved(updated);
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-md">
      <div className="flex flex-col gap-xxs">
        <label htmlFor="profile-edit-name" className="text-body text-[var(--text-secondary)]">
          Name
        </label>
        <input
          id="profile-edit-name"
          className={INPUT_CLASSNAME}
          aria-invalid={!!errors.name}
          {...register('name', { required: 'Name is required.', maxLength: { value: 100, message: 'Name must be 100 characters or fewer.' } })}
        />
        {errors.name && (
          <p role="alert" className="text-caption text-[var(--danger)]">
            {errors.name.message}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-xxs">
        <label htmlFor="profile-edit-school" className="text-body text-[var(--text-secondary)]">
          School
        </label>
        <input id="profile-edit-school" className={INPUT_CLASSNAME} {...register('school')} />
      </div>

      <div className="flex flex-col gap-xxs">
        <label htmlFor="profile-edit-jersey" className="text-body text-[var(--text-secondary)]">
          Jersey number
        </label>
        <input id="profile-edit-jersey" className={INPUT_CLASSNAME} {...register('jerseyNumber')} />
      </div>

      <div className="flex flex-col gap-xxs">
        <label htmlFor="profile-edit-photo" className="text-body text-[var(--text-secondary)]">
          Photo URL
        </label>
        <input id="profile-edit-photo" className={INPUT_CLASSNAME} {...register('photoUrl')} />
      </div>

      <fieldset className="flex flex-col gap-xxs">
        <legend className="text-body text-[var(--text-secondary)]">Emergency contact</legend>
        <label htmlFor="profile-edit-ec-name" className="text-caption text-[var(--text-secondary)]">
          Contact name
        </label>
        <input id="profile-edit-ec-name" className={INPUT_CLASSNAME} {...register('emergencyContactName')} />
        <label htmlFor="profile-edit-ec-phone" className="text-caption text-[var(--text-secondary)]">
          Contact phone
        </label>
        <input id="profile-edit-ec-phone" className={INPUT_CLASSNAME} {...register('emergencyContactPhone')} />
      </fieldset>

      {canEditGuardianFields && (
        <label htmlFor="profile-edit-allow-spend" className="flex items-center gap-sm text-body text-[var(--text-primary)]">
          <input id="profile-edit-allow-spend" type="checkbox" {...register('allowChildTokenSpendWithoutApproval')} />
          Allow this player to spend tokens without approval
        </label>
      )}

      {formError && (
        <p role="alert" className="text-body text-[var(--danger)]">
          {formError}
        </p>
      )}

      <div className="mt-sm flex justify-end">
        <button
          type="submit"
          disabled={isSubmitting}
          className="rounded-sm bg-[var(--brand-primary)] p-sm text-body font-semibold text-[#0D0D0D] shadow-button-primary disabled:opacity-60"
        >
          {isSubmitting ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  );
}
