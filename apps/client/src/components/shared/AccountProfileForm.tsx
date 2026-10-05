'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMemo, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';

import { apiRequest } from '../../lib/api/apiClient';
import { parseApiErrorBody } from '../../lib/api/apiError';
import { buildAccountProfileSchema, type AccountProfileFormValues } from '../../lib/schemas/accountProfileSchema';
import type { AccountType } from '../../types/auth';

import { PhoneInput } from './PhoneInput';
import { PhotoUploadField } from './PhotoUploadField';

// api §3 MeResponseDto's editable slice (Task 2.22) — the fields
// AccountProfileForm reads/writes. Deliberately NOT the same shape as
// player/ProfileEditForm.tsx's `PlayerProfileDetail` (name/school/
// jerseyNumber/emergencyContact, `PATCH /player-profiles/:id`): the writing
// plan's Task 18.1 note ("reused here — confirm ProfileEditForm is
// role-aware, not player-specific") doesn't hold up against the real code —
// that component is hard-wired to PlayerProfileResponseDto and the
// player-profiles endpoint, with no `firstName`/`lastName`/`phone` fields at
// all. This is a new, separate component targeting `GET/PATCH /me`
// (UpdateMeDto) instead of repurposing an incompatible one; see the Phase 18
// wrap-up report for the full deviation note.
export interface AccountProfileValues {
  firstName: string;
  lastName: string;
  phone: string | null;
  photoUrl: string | null;
  // Optional: null/absent until the user first saves their preferences, in
  // which case `toDefaultValues` falls back to the defaults. `GET/PATCH /me`
  // return the saved value so the checkboxes reflect what is stored.
  notificationPrefs?: Record<string, boolean> | null;
}

export interface AccountProfileFormProps {
  profile: AccountProfileValues;
  /** `GET /me`'s `accountType` — `CHILD` renders the narrower field set (fe §7.2). */
  accountType: AccountType;
  onSaved: (updated: AccountProfileValues) => void;
}

const GENERIC_SAVE_ERROR = "Some changes couldn't be saved. Please try again.";

const INPUT_CLASSNAME =
  'w-full min-w-0';

function toDefaultValues(profile: AccountProfileValues): AccountProfileFormValues {
  const prefs = profile.notificationPrefs ?? {};
  return {
    firstName: profile.firstName,
    lastName: profile.lastName,
    phone: profile.phone ?? '',
    photoUrl: profile.photoUrl ?? '',
    emailNotifications: prefs.email !== false,
    smsNotifications: prefs.sms === true,
  };
}

// fe §3/§7.2 — `/account/profile`'s basics editor, `PATCH /me` (api §3 —
// firstName/lastName/phone/photoUrl/notificationPrefs, every authenticated
// role). Mirrors the CHILD-field-restriction pattern §7.2 documents once:
// `accountType: 'CHILD'` omits firstName/lastName/phone inputs entirely
// (rendering fewer fields, not rendering-all-and-rejecting-on-submit),
// leaving only photoUrl/notificationPrefs — the server's own
// `CHILD_NOT_EDITABLE_FIELDS` whitelist (users.service.ts) is the security
// boundary; this is the UX optimization mirroring it (fe §7.2's own framing).
// A stale client/direct API call sending a disallowed field anyway still
// gets a real `403 CHILD_FIELD_NOT_EDITABLE`, surfaced below as the generic
// toast-shaped inline alert §9.4 describes (this task commits before Task
// 18.3 builds the actual toast primitive, so it uses the same inline
// `role="alert"` stopgap every prior phase has used). Task 18.1.
export function AccountProfileForm({ profile, accountType, onSaved }: AccountProfileFormProps) {
  const isChild = accountType === 'CHILD';
  const schema = useMemo(() => buildAccountProfileSchema(isChild), [isChild]);
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    control,
    formState: { errors, isSubmitting },
  } = useForm<AccountProfileFormValues>({
    resolver: zodResolver(schema),
    mode: 'onTouched',
    defaultValues: toDefaultValues(profile),
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);

    const body: Record<string, unknown> = {
      // null clears a removed photo (PATCH /me accepts null).
      photoUrl: values.photoUrl || null,
      notificationPrefs: { email: values.emailNotifications, sms: values.smsNotifications },
    };
    if (!isChild) {
      body.firstName = values.firstName;
      body.lastName = values.lastName;
      body.phone = values.phone || undefined;
    }

    const res = await apiRequest('/me', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      await parseApiErrorBody(res);
      setFormError(GENERIC_SAVE_ERROR);
      return;
    }

    const updated = (await res.json()) as AccountProfileValues;
    setFormError(null);
    onSaved(updated);
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-md">
      {!isChild && (
        <>
          <div className="flex flex-wrap gap-md">
            <div className="flex min-w-0 flex-[1_1_11rem] flex-col gap-xxs">
              <label htmlFor="account-profile-first-name" className="field-label">
                First name
              </label>
              <input
                id="account-profile-first-name"
                placeholder="John"
                autoComplete="given-name"
                className={INPUT_CLASSNAME}
                aria-invalid={!!errors.firstName}
                aria-describedby={errors.firstName ? 'account-profile-first-name-error' : undefined}
                {...register('firstName')}
              />
              {errors.firstName && (
                <p id="account-profile-first-name-error" role="alert" className="text-caption text-danger">
                  {errors.firstName.message}
                </p>
              )}
            </div>

            <div className="flex min-w-0 flex-[1_1_11rem] flex-col gap-xxs">
              <label htmlFor="account-profile-last-name" className="field-label">
                Last name
              </label>
              <input
                id="account-profile-last-name"
                placeholder="Smith"
                autoComplete="family-name"
                className={INPUT_CLASSNAME}
                aria-invalid={!!errors.lastName}
                aria-describedby={errors.lastName ? 'account-profile-last-name-error' : undefined}
                {...register('lastName')}
              />
              {errors.lastName && (
                <p id="account-profile-last-name-error" role="alert" className="text-caption text-danger">
                  {errors.lastName.message}
                </p>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-xxs">
            <label htmlFor="account-profile-phone" className="field-label">
              Phone
            </label>
            <Controller
              control={control}
              name="phone"
              render={({ field }) => (
                <PhoneInput
                  id="account-profile-phone"
                  value={field.value ?? ''}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  className={INPUT_CLASSNAME}
                  aria-invalid={!!errors.phone}
                  aria-describedby={errors.phone ? 'account-profile-phone-error' : undefined}
                />
              )}
            />
            {errors.phone && (
              <p id="account-profile-phone-error" role="alert" className="text-caption text-danger">
                {errors.phone.message}
              </p>
            )}
          </div>
        </>
      )}

      <Controller
        control={control}
        name="photoUrl"
        render={({ field }) => (
          <PhotoUploadField
            id="account-profile-photo"
            label="Photo"
            value={field.value ?? ''}
            onChange={(url) => field.onChange(url)}
            initials={`${profile.firstName.charAt(0)}${profile.lastName.charAt(0)}`.toUpperCase()}
            disabled={isSubmitting}
          />
        )}
      />
      {errors.photoUrl && (
        <p id="account-profile-photo-error" role="alert" className="text-caption text-danger">
          {errors.photoUrl.message}
        </p>
      )}

      <fieldset className="flex flex-col gap-xs">
        <legend className="text-body text-text-secondary">Notifications</legend>
        <label htmlFor="account-profile-email-notifications" className="flex items-center gap-sm text-body text-text-primary">
          <input id="account-profile-email-notifications" type="checkbox" {...register('emailNotifications')} />
          Email notifications
        </label>
        <label htmlFor="account-profile-sms-notifications" className="flex items-center gap-sm text-body text-text-primary">
          <input id="account-profile-sms-notifications" type="checkbox" {...register('smsNotifications')} />
          SMS notifications
        </label>
      </fieldset>

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
