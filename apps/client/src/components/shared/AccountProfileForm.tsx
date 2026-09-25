'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';

import { apiRequest } from '../../lib/api/apiClient';
import { parseApiErrorBody } from '../../lib/api/apiError';
import type { AccountType } from '../../types/auth';

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
  // Optional, not required: the real `MeResponseDto` (api §3/Task 2.22)
  // never exposes this field back on GET/PATCH — `UpdateMeDto` accepts it as
  // write-only, so a fetched `MeProfile` (useMe.ts) has no value to prefill
  // from and this always falls back to the defaults in `toDefaultValues`.
  notificationPrefs?: Record<string, boolean> | null;
}

export interface AccountProfileFormProps {
  profile: AccountProfileValues;
  /** `GET /me`'s `accountType` — `CHILD` renders the narrower field set (fe §7.2). */
  accountType: AccountType;
  onSaved: (updated: AccountProfileValues) => void;
}

interface FormValues {
  firstName: string;
  lastName: string;
  phone: string;
  photoUrl: string;
  emailNotifications: boolean;
  smsNotifications: boolean;
}

const GENERIC_SAVE_ERROR = "Some changes couldn't be saved. Please try again.";

const INPUT_CLASSNAME =
  'rounded-sm border border-[var(--border-soft)] bg-[var(--surface-0)] p-sm text-body text-[var(--text-primary)] outline-none focus:border-[var(--brand-primary)]';

function toDefaultValues(profile: AccountProfileValues): FormValues {
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
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ defaultValues: toDefaultValues(profile) });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);

    const body: Record<string, unknown> = {
      photoUrl: values.photoUrl.trim() || undefined,
      notificationPrefs: { email: values.emailNotifications, sms: values.smsNotifications },
    };
    if (!isChild) {
      body.firstName = values.firstName;
      body.lastName = values.lastName;
      body.phone = values.phone.trim() || undefined;
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
          <div className="flex flex-col gap-xxs">
            <label htmlFor="account-profile-first-name" className="text-body text-[var(--text-secondary)]">
              First name
            </label>
            <input
              id="account-profile-first-name"
              className={INPUT_CLASSNAME}
              aria-invalid={!!errors.firstName}
              {...register('firstName', { required: 'First name is required.', maxLength: { value: 100, message: 'First name must be 100 characters or fewer.' } })}
            />
            {errors.firstName && (
              <p role="alert" className="text-caption text-[var(--danger)]">
                {errors.firstName.message}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-xxs">
            <label htmlFor="account-profile-last-name" className="text-body text-[var(--text-secondary)]">
              Last name
            </label>
            <input
              id="account-profile-last-name"
              className={INPUT_CLASSNAME}
              aria-invalid={!!errors.lastName}
              {...register('lastName', { required: 'Last name is required.', maxLength: { value: 100, message: 'Last name must be 100 characters or fewer.' } })}
            />
            {errors.lastName && (
              <p role="alert" className="text-caption text-[var(--danger)]">
                {errors.lastName.message}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-xxs">
            <label htmlFor="account-profile-phone" className="text-body text-[var(--text-secondary)]">
              Phone
            </label>
            <input id="account-profile-phone" type="tel" className={INPUT_CLASSNAME} {...register('phone')} />
          </div>
        </>
      )}

      <div className="flex flex-col gap-xxs">
        <label htmlFor="account-profile-photo" className="text-body text-[var(--text-secondary)]">
          Photo URL
        </label>
        <input id="account-profile-photo" className={INPUT_CLASSNAME} {...register('photoUrl')} />
      </div>

      <fieldset className="flex flex-col gap-xs">
        <legend className="text-body text-[var(--text-secondary)]">Notifications</legend>
        <label htmlFor="account-profile-email-notifications" className="flex items-center gap-sm text-body text-[var(--text-primary)]">
          <input id="account-profile-email-notifications" type="checkbox" {...register('emailNotifications')} />
          Email notifications
        </label>
        <label htmlFor="account-profile-sms-notifications" className="flex items-center gap-sm text-body text-[var(--text-primary)]">
          <input id="account-profile-sms-notifications" type="checkbox" {...register('smsNotifications')} />
          SMS notifications
        </label>
      </fieldset>

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
