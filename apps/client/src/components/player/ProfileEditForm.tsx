'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';

import { apiRequest } from '../../lib/api/apiClient';
import { parseApiErrorBody } from '../../lib/api/apiError';
import { updatePlayerProfileSchema, type UpdatePlayerProfileFormValues } from '../../lib/schemas/updatePlayerProfileSchema';
import { PhoneInput } from '../shared/PhoneInput';
import { PhotoUploadField } from '../shared/PhotoUploadField';

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

const GENERIC_SAVE_ERROR = "Some changes couldn't be saved. Please try again.";

const INPUT_CLASSNAME =
  'w-full min-w-0';

function toDefaultValues(profile: PlayerProfileDetail): UpdatePlayerProfileFormValues {
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
    control,
    formState: { errors, isSubmitting },
  } = useForm<UpdatePlayerProfileFormValues>({
    resolver: zodResolver(updatePlayerProfileSchema),
    mode: 'onTouched',
    defaultValues: toDefaultValues(profile),
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);

    const body: Record<string, unknown> = {
      name: values.name.trim(),
      school: values.school.trim() || undefined,
      jerseyNumber: values.jerseyNumber.trim() || undefined,
      // null clears a removed photo.
      photoUrl: values.photoUrl.trim() || null,
    };
    if (values.emergencyContactName.trim() || values.emergencyContactPhone) {
      body.emergencyContact = { name: values.emergencyContactName.trim(), phone: values.emergencyContactPhone };
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
        <label htmlFor="profile-edit-name" className="field-label">
          Name
        </label>
        <input
          id="profile-edit-name"
          placeholder="Alex Johnson"
          autoComplete="name"
          className={INPUT_CLASSNAME}
          aria-invalid={!!errors.name}
          aria-describedby={errors.name ? 'profile-edit-name-error' : undefined}
          {...register('name')}
        />
        {errors.name && (
          <p id="profile-edit-name-error" role="alert" className="text-caption text-danger">
            {errors.name.message}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-xxs">
        <label htmlFor="profile-edit-school" className="field-label">
          School
        </label>
        <input
          id="profile-edit-school"
          placeholder="Lincoln Elementary School"
          autoComplete="organization"
          className={INPUT_CLASSNAME}
          aria-invalid={!!errors.school}
          aria-describedby={errors.school ? 'profile-edit-school-error' : undefined}
          {...register('school')}
        />
        {errors.school && (
          <p id="profile-edit-school-error" role="alert" className="text-caption text-danger">
            {errors.school.message}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-xxs">
        <label htmlFor="profile-edit-jersey" className="field-label">
          Jersey number
        </label>
        <input
          id="profile-edit-jersey"
          placeholder="23"
          autoComplete="off"
          className={INPUT_CLASSNAME}
          aria-invalid={!!errors.jerseyNumber}
          aria-describedby={errors.jerseyNumber ? 'profile-edit-jersey-error' : undefined}
          {...register('jerseyNumber')}
        />
        {errors.jerseyNumber && (
          <p id="profile-edit-jersey-error" role="alert" className="text-caption text-danger">
            {errors.jerseyNumber.message}
          </p>
        )}
      </div>

      <Controller
        control={control}
        name="photoUrl"
        render={({ field }) => (
          <PhotoUploadField
            id="profile-edit-photo"
            label="Photo"
            value={field.value ?? ''}
            onChange={(url) => field.onChange(url)}
            initials={profile.name.charAt(0).toUpperCase()}
            disabled={isSubmitting}
          />
        )}
      />
      {errors.photoUrl && (
        <p id="profile-edit-photo-error" role="alert" className="text-caption text-danger">
          {errors.photoUrl.message}
        </p>
      )}

      <fieldset className="flex flex-col gap-xxs">
        <legend className="text-body text-text-secondary">Emergency contact</legend>
        <label htmlFor="profile-edit-ec-name" className="field-label">
          Contact name
        </label>
        <input
          id="profile-edit-ec-name"
          placeholder="Jordan Johnson"
          autoComplete="off"
          className={INPUT_CLASSNAME}
          aria-invalid={!!errors.emergencyContactName}
          aria-describedby={errors.emergencyContactName ? 'profile-edit-ec-name-error' : undefined}
          {...register('emergencyContactName')}
        />
        {errors.emergencyContactName && (
          <p id="profile-edit-ec-name-error" role="alert" className="text-caption text-danger">
            {errors.emergencyContactName.message}
          </p>
        )}
        <label htmlFor="profile-edit-ec-phone" className="field-label">
          Contact phone
        </label>
        <Controller
          control={control}
          name="emergencyContactPhone"
          render={({ field }) => (
            <PhoneInput
              id="profile-edit-ec-phone"
              value={field.value ?? ''}
              onChange={field.onChange}
              onBlur={field.onBlur}
              autoComplete="off"
              className={INPUT_CLASSNAME}
              aria-invalid={!!errors.emergencyContactPhone}
              aria-describedby={errors.emergencyContactPhone ? 'profile-edit-ec-phone-error' : undefined}
            />
          )}
        />
        {errors.emergencyContactPhone && (
          <p id="profile-edit-ec-phone-error" role="alert" className="text-caption text-danger">
            {errors.emergencyContactPhone.message}
          </p>
        )}
      </fieldset>

      {canEditGuardianFields && (
        <label htmlFor="profile-edit-allow-spend" className="flex items-center gap-sm text-body text-text-primary">
          <input id="profile-edit-allow-spend" type="checkbox" {...register('allowChildTokenSpendWithoutApproval')} />
          Allow this player to spend tokens without approval
        </label>
      )}

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
  );
}
