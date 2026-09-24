'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';

import {
  anonymousCoachAcceptSchema,
  anonymousPlayerRegistrationSchema,
  GENDERS,
  type AnonymousCoachAcceptFormValues,
  type AnonymousPlayerRegistrationFormValues,
  type Gender,
} from '../../lib/schemas/anonymousJoinSchema';

import type { ShareLinkType } from './ShareLinkDispatcher';

// api §4.4 — the two anonymous-branch request bodies this form can build.
// ANONYMOUS_REGISTRATION (PLAYER_STATIC) carries the full set; COACH_ACCEPT
// anonymous (COACH_UNIQUE) carries only `password` (verified against
// RedeemShareLinkDto — no `email` field, the target email comes from the
// link itself server-side).
export type AnonymousJoinRequestBody =
  | {
      email: string;
      password: string;
      phone: string;
      playerName: string;
      dateOfBirth: string;
      gender: Gender;
      isSelf: boolean;
    }
  | { password: string };

export interface AnonymousJoinFormProps {
  type: ShareLinkType;
  /** Builds the branch-specific body (fe §4.2) — actual POST /redeem call is wired in by the parent (Task 11.10). */
  onSubmit: (body: AnonymousJoinRequestBody) => void;
  isSubmitting?: boolean;
  submitError?: string | null;
}

const inputClassName =
  'rounded-sm border border-[var(--border-soft)] bg-[var(--surface-1)] p-sm text-body text-[var(--text-primary)] outline-none focus:border-[var(--brand-primary)]';

function SubmitError({ message }: { message: string | null }) {
  if (!message) {
    return null;
  }
  return (
    <p role="alert" className="text-body text-[var(--danger)]">
      {message}
    </p>
  );
}

function AnonymousCoachAcceptFields({ onSubmit, isSubmitting, submitError }: Omit<AnonymousJoinFormProps, 'type'>) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<AnonymousCoachAcceptFormValues>({ resolver: zodResolver(anonymousCoachAcceptSchema) });

  const submit = handleSubmit((values) => onSubmit({ password: values.password }));

  return (
    <form onSubmit={submit} noValidate className="flex w-full flex-col gap-md">
      <div className="flex flex-col gap-xxs">
        <label htmlFor="anon-coach-password" className="text-body text-[var(--text-secondary)]">
          Choose a password
        </label>
        <input
          id="anon-coach-password"
          type="password"
          autoComplete="new-password"
          className={inputClassName}
          aria-invalid={!!errors.password}
          aria-describedby={errors.password ? 'anon-coach-password-error' : undefined}
          {...register('password')}
        />
        {errors.password && (
          <p id="anon-coach-password-error" role="alert" className="text-caption text-[var(--danger)]">
            {errors.password.message}
          </p>
        )}
      </div>

      <SubmitError message={submitError ?? null} />

      <button
        type="submit"
        disabled={isSubmitting}
        className="rounded-sm bg-[var(--brand-primary)] p-sm text-body font-semibold text-[#0D0D0D] shadow-button-primary disabled:opacity-60"
      >
        {isSubmitting ? 'Joining…' : 'Accept invitation'}
      </button>
    </form>
  );
}

function AnonymousPlayerRegistrationFields({ onSubmit, isSubmitting, submitError }: Omit<AnonymousJoinFormProps, 'type'>) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<AnonymousPlayerRegistrationFormValues>({
    resolver: zodResolver(anonymousPlayerRegistrationSchema),
    defaultValues: { isSelf: 'true' },
  });

  const submit = handleSubmit((values) =>
    onSubmit({
      email: values.email,
      password: values.password,
      phone: values.phone,
      playerName: values.playerName,
      dateOfBirth: values.dateOfBirth,
      gender: values.gender,
      isSelf: values.isSelf === 'true',
    }),
  );

  return (
    <form onSubmit={submit} noValidate className="flex w-full flex-col gap-md">
      <div className="flex flex-col gap-xxs">
        <label htmlFor="anon-player-is-self" className="text-body text-[var(--text-secondary)]">
          Who is this registration for?
        </label>
        <select id="anon-player-is-self" className={inputClassName} defaultValue="true" {...register('isSelf')}>
          <option value="true">Me</option>
          <option value="false">My child</option>
        </select>
      </div>

      <div className="flex flex-col gap-xxs">
        <label htmlFor="anon-player-email" className="text-body text-[var(--text-secondary)]">
          Email
        </label>
        <input id="anon-player-email" type="email" autoComplete="email" className={inputClassName} {...register('email')} />
        {errors.email && (
          <p role="alert" className="text-caption text-[var(--danger)]">
            {errors.email.message}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-xxs">
        <label htmlFor="anon-player-password" className="text-body text-[var(--text-secondary)]">
          Password
        </label>
        <input
          id="anon-player-password"
          type="password"
          autoComplete="new-password"
          className={inputClassName}
          {...register('password')}
        />
        {errors.password && (
          <p role="alert" className="text-caption text-[var(--danger)]">
            {errors.password.message}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-xxs">
        <label htmlFor="anon-player-phone" className="text-body text-[var(--text-secondary)]">
          Phone number
        </label>
        <input id="anon-player-phone" type="tel" autoComplete="tel" className={inputClassName} {...register('phone')} />
        {errors.phone && (
          <p role="alert" className="text-caption text-[var(--danger)]">
            {errors.phone.message}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-xxs">
        <label htmlFor="anon-player-name" className="text-body text-[var(--text-secondary)]">
          Player&apos;s name
        </label>
        <input id="anon-player-name" type="text" className={inputClassName} {...register('playerName')} />
        {errors.playerName && (
          <p role="alert" className="text-caption text-[var(--danger)]">
            {errors.playerName.message}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-xxs">
        <label htmlFor="anon-player-dob" className="text-body text-[var(--text-secondary)]">
          Date of birth
        </label>
        <input id="anon-player-dob" type="date" className={inputClassName} {...register('dateOfBirth')} />
        {errors.dateOfBirth && (
          <p role="alert" className="text-caption text-[var(--danger)]">
            {errors.dateOfBirth.message}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-xxs">
        <label htmlFor="anon-player-gender" className="text-body text-[var(--text-secondary)]">
          Gender
        </label>
        <select id="anon-player-gender" className={inputClassName} defaultValue="" {...register('gender')}>
          <option value="" disabled>
            Select…
          </option>
          {GENDERS.map((gender) => (
            <option key={gender} value={gender}>
              {gender.replace(/_/g, ' ').toLowerCase()}
            </option>
          ))}
        </select>
        {errors.gender && (
          <p role="alert" className="text-caption text-[var(--danger)]">
            {errors.gender.message}
          </p>
        )}
      </div>

      <SubmitError message={submitError ?? null} />

      <button
        type="submit"
        disabled={isSubmitting}
        className="rounded-sm bg-[var(--brand-primary)] p-sm text-body font-semibold text-[#0D0D0D] shadow-button-primary disabled:opacity-60"
      >
        {isSubmitting ? 'Joining…' : 'Create account'}
      </button>
    </form>
  );
}

// fe §4.2 — rendered for "no access token, type=PLAYER_STATIC or
// COACH_UNIQUE". The two link types need genuinely different fields (a
// coach accepting a unique invite already has a known target email and
// needs no player-profile fields at all), so this dispatches to one of two
// field sets rather than rendering one form with half its inputs hidden.
export function AnonymousJoinForm({ type, onSubmit, isSubmitting = false, submitError = null }: AnonymousJoinFormProps) {
  if (type === 'COACH_UNIQUE') {
    return <AnonymousCoachAcceptFields onSubmit={onSubmit} isSubmitting={isSubmitting} submitError={submitError} />;
  }
  return <AnonymousPlayerRegistrationFields onSubmit={onSubmit} isSubmitting={isSubmitting} submitError={submitError} />;
}
