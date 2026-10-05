'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { Controller, useForm } from 'react-hook-form';

import {
  anonymousCoachAcceptSchema,
  anonymousPlayerRegistrationSchema,
  GENDERS,
  type AnonymousCoachAcceptFormValues,
  type AnonymousPlayerRegistrationFormValues,
  type Gender,
} from '../../lib/schemas/anonymousJoinSchema';
import { PhoneInput } from '../shared/PhoneInput';

import type { ShareLinkType } from './ShareLinkDispatcher';

// api §4.4 — the two anonymous-branch request bodies this form can build.
// ANONYMOUS_REGISTRATION (PLAYER_STATIC) carries the full set; COACH_ACCEPT
// anonymous (COACH_UNIQUE) carries only `password` (verified against
// RedeemShareLinkDto — no `email` field, the target email comes from the
// link itself server-side).
export type AnonymousJoinRequestBody =
  | {
      parentFirstName: string;
      parentLastName: string;
      email: string;
      password: string;
      phone: string;
      playerName: string;
      dateOfBirth: string;
      gender: Gender;
      isSelf: boolean;
    }
  | { firstName: string; lastName: string; password: string };

export interface AnonymousJoinFormProps {
  type: ShareLinkType;
  /** Builds the branch-specific body (fe §4.2) — actual POST /redeem call is wired in by the parent (Task 11.10). */
  onSubmit: (body: AnonymousJoinRequestBody) => void;
  isSubmitting?: boolean;
  submitError?: string | null;
  /** Where "Already have an account? Sign in" points (login with a `next` back to this join link). */
  signInHref?: string;
}

const inputClassName =
  'w-full min-w-0';

function SubmitError({ message }: { message: string | null }) {
  if (!message) {
    return null;
  }
  return (
    <p role="alert" className="text-body text-danger">
      {message}
    </p>
  );
}

function SignInLink({ href }: { href?: string }) {
  if (!href) {
    return null;
  }
  return (
    <p className="text-center text-caption text-text-secondary">
      Already have an account?{' '}
      <Link href={href} className="underline underline-offset-4 transition-colors hover:text-brand-primary">
        Sign in
      </Link>
    </p>
  );
}

function AnonymousCoachAcceptFields({ onSubmit, isSubmitting, submitError, signInHref }: Omit<AnonymousJoinFormProps, 'type'>) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<AnonymousCoachAcceptFormValues>({
    resolver: zodResolver(anonymousCoachAcceptSchema),
    mode: 'onTouched',
    defaultValues: { firstName: '', lastName: '', password: '' },
  });

  const submit = handleSubmit((values) =>
    onSubmit({ firstName: values.firstName, lastName: values.lastName, password: values.password }),
  );

  return (
    <form onSubmit={submit} noValidate className="flex w-full flex-col gap-md">
      <div className="flex flex-wrap gap-md">
        <div className="flex min-w-0 flex-[1_1_11rem] flex-col gap-xxs">
          <label htmlFor="anon-coach-first-name" className="field-label">
            First name
          </label>
          <input
            id="anon-coach-first-name"
            type="text"
            placeholder="Casey"
            autoComplete="given-name"
            className={inputClassName}
            aria-invalid={!!errors.firstName}
            aria-describedby={errors.firstName ? 'anon-coach-first-name-error' : undefined}
            {...register('firstName')}
          />
          {errors.firstName && (
            <p id="anon-coach-first-name-error" role="alert" className="text-caption text-danger">
              {errors.firstName.message}
            </p>
          )}
        </div>

        <div className="flex min-w-0 flex-[1_1_11rem] flex-col gap-xxs">
          <label htmlFor="anon-coach-last-name" className="field-label">
            Last name
          </label>
          <input
            id="anon-coach-last-name"
            type="text"
            placeholder="Morgan"
            autoComplete="family-name"
            className={inputClassName}
            aria-invalid={!!errors.lastName}
            aria-describedby={errors.lastName ? 'anon-coach-last-name-error' : undefined}
            {...register('lastName')}
          />
          {errors.lastName && (
            <p id="anon-coach-last-name-error" role="alert" className="text-caption text-danger">
              {errors.lastName.message}
            </p>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-xxs">
        <label htmlFor="anon-coach-password" className="field-label">
          Choose a password
        </label>
        <input
          id="anon-coach-password"
          type="password"
          placeholder="At least 8 characters"
          autoComplete="new-password"
          className={inputClassName}
          aria-invalid={!!errors.password}
          aria-describedby={errors.password ? 'anon-coach-password-error' : undefined}
          {...register('password')}
        />
        {errors.password && (
          <p id="anon-coach-password-error" role="alert" className="text-caption text-danger">
            {errors.password.message}
          </p>
        )}
      </div>

      <SubmitError message={submitError ?? null} />

      <button
        type="submit"
        disabled={isSubmitting}
        className="btn btn-primary"
      >
        {isSubmitting ? 'Joining…' : 'Accept invitation'}
      </button>

      <SignInLink href={signInHref} />
    </form>
  );
}

function AnonymousPlayerRegistrationFields({ onSubmit, isSubmitting, submitError, signInHref }: Omit<AnonymousJoinFormProps, 'type'>) {
  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<AnonymousPlayerRegistrationFormValues>({
    resolver: zodResolver(anonymousPlayerRegistrationSchema),
    mode: 'onTouched',
    defaultValues: {
      isSelf: 'true',
      parentFirstName: '',
      parentLastName: '',
      email: '',
      password: '',
      phone: '',
      playerName: '',
      dateOfBirth: '',
      // '' is the disabled "Select…" option; the enum schema rejects it with "Select a gender."
      gender: '' as AnonymousPlayerRegistrationFormValues['gender'],
    },
  });

  const submit = handleSubmit((values) =>
    onSubmit({
      parentFirstName: values.parentFirstName,
      parentLastName: values.parentLastName,
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
        <label htmlFor="anon-player-is-self" className="field-label">
          Who is this registration for?
        </label>
        <select id="anon-player-is-self" className={inputClassName} {...register('isSelf')}>
          <option value="true">Me</option>
          <option value="false">My child</option>
        </select>
      </div>

      <div className="flex flex-wrap gap-md">
        <div className="flex min-w-0 flex-[1_1_11rem] flex-col gap-xxs">
          <label htmlFor="anon-parent-first-name" className="field-label">
            Your first name
          </label>
          <input
            id="anon-parent-first-name"
            type="text"
            placeholder="Taylor"
            autoComplete="given-name"
            className={inputClassName}
            aria-invalid={!!errors.parentFirstName}
            aria-describedby={errors.parentFirstName ? 'anon-parent-first-name-error' : undefined}
            {...register('parentFirstName')}
          />
          {errors.parentFirstName && (
            <p id="anon-parent-first-name-error" role="alert" className="text-caption text-danger">
              {errors.parentFirstName.message}
            </p>
          )}
        </div>

        <div className="flex min-w-0 flex-[1_1_11rem] flex-col gap-xxs">
          <label htmlFor="anon-parent-last-name" className="field-label">
            Your last name
          </label>
          <input
            id="anon-parent-last-name"
            type="text"
            placeholder="Smith"
            autoComplete="family-name"
            className={inputClassName}
            aria-invalid={!!errors.parentLastName}
            aria-describedby={errors.parentLastName ? 'anon-parent-last-name-error' : undefined}
            {...register('parentLastName')}
          />
          {errors.parentLastName && (
            <p id="anon-parent-last-name-error" role="alert" className="text-caption text-danger">
              {errors.parentLastName.message}
            </p>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-xxs">
        <label htmlFor="anon-player-email" className="field-label">
          Email
        </label>
        <input
          id="anon-player-email"
          type="email"
          inputMode="email"
          placeholder="you@example.com"
          autoComplete="email"
          className={inputClassName}
          aria-invalid={!!errors.email}
          aria-describedby={errors.email ? 'anon-player-email-error' : undefined}
          {...register('email')}
        />
        {errors.email && (
          <p id="anon-player-email-error" role="alert" className="text-caption text-danger">
            {errors.email.message}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-xxs">
        <label htmlFor="anon-player-password" className="field-label">
          Password
        </label>
        <input
          id="anon-player-password"
          type="password"
          placeholder="At least 8 characters"
          autoComplete="new-password"
          className={inputClassName}
          aria-invalid={!!errors.password}
          aria-describedby={errors.password ? 'anon-player-password-error' : undefined}
          {...register('password')}
        />
        {errors.password && (
          <p id="anon-player-password-error" role="alert" className="text-caption text-danger">
            {errors.password.message}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-xxs">
        <label htmlFor="anon-player-phone" className="field-label">
          Phone number
        </label>
        <Controller
          control={control}
          name="phone"
          render={({ field }) => (
            <PhoneInput
              id="anon-player-phone"
              value={field.value}
              onChange={field.onChange}
              onBlur={field.onBlur}
              className={inputClassName}
              aria-invalid={!!errors.phone}
              aria-describedby={errors.phone ? 'anon-player-phone-error' : undefined}
            />
          )}
        />
        {errors.phone && (
          <p id="anon-player-phone-error" role="alert" className="text-caption text-danger">
            {errors.phone.message}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-xxs">
        <label htmlFor="anon-player-name" className="field-label">
          Player&apos;s name
        </label>
        <input
          id="anon-player-name"
          type="text"
          placeholder="Jordan Smith"
          autoComplete="name"
          className={inputClassName}
          aria-invalid={!!errors.playerName}
          aria-describedby={errors.playerName ? 'anon-player-name-error' : undefined}
          {...register('playerName')}
        />
        {errors.playerName && (
          <p id="anon-player-name-error" role="alert" className="text-caption text-danger">
            {errors.playerName.message}
          </p>
        )}
      </div>

      <div className="flex flex-wrap gap-md">
        <div className="flex min-w-0 flex-[1_1_11rem] flex-col gap-xxs">
          <label htmlFor="anon-player-dob" className="field-label">
            Date of birth
          </label>
          <input
            id="anon-player-dob"
            type="date"
            autoComplete="bday"
            className={inputClassName}
            aria-invalid={!!errors.dateOfBirth}
            aria-describedby={errors.dateOfBirth ? 'anon-player-dob-error' : undefined}
            {...register('dateOfBirth')}
          />
          {errors.dateOfBirth && (
            <p id="anon-player-dob-error" role="alert" className="text-caption text-danger">
              {errors.dateOfBirth.message}
            </p>
          )}
        </div>

        <div className="flex min-w-0 flex-[1_1_11rem] flex-col gap-xxs">
          <label htmlFor="anon-player-gender" className="field-label">
            Gender
          </label>
          <select
            id="anon-player-gender"
            className={inputClassName}
            aria-invalid={!!errors.gender}
            aria-describedby={errors.gender ? 'anon-player-gender-error' : undefined}
            {...register('gender')}
          >
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
            <p id="anon-player-gender-error" role="alert" className="text-caption text-danger">
              {errors.gender.message}
            </p>
          )}
        </div>
      </div>

      <SubmitError message={submitError ?? null} />

      <button
        type="submit"
        disabled={isSubmitting}
        className="btn btn-primary"
      >
        {isSubmitting ? 'Joining…' : 'Create account'}
      </button>

      <SignInLink href={signInHref} />
    </form>
  );
}

// fe §4.2 — rendered for "no access token, type=PLAYER_STATIC or
// COACH_UNIQUE". The two link types need genuinely different fields (a
// coach accepting a unique invite already has a known target email and
// needs no player-profile fields at all), so this dispatches to one of two
// field sets rather than rendering one form with half its inputs hidden.
export function AnonymousJoinForm({ type, onSubmit, isSubmitting = false, submitError = null, signInHref }: AnonymousJoinFormProps) {
  if (type === 'COACH_UNIQUE') {
    return <AnonymousCoachAcceptFields onSubmit={onSubmit} isSubmitting={isSubmitting} submitError={submitError} signInHref={signInHref} />;
  }
  return <AnonymousPlayerRegistrationFields onSubmit={onSubmit} isSubmitting={isSubmitting} submitError={submitError} signInHref={signInHref} />;
}
