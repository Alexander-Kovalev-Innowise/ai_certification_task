'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';

import { publicApiRequest } from '../../lib/api/apiClient';
import { parseApiErrorBody, readRetryAfterSeconds } from '../../lib/api/apiError';
import { GENDERS } from '../../lib/schemas/anonymousJoinSchema';
import { campSignupSchema, type CampSignupFormValues } from '../../lib/schemas/campSignupSchema';
import { RateLimitNotice } from '../auth/RateLimitNotice';
import { PhoneInput } from '../shared/PhoneInput';
import type { ShareLinkPreviewResponse } from '../share-link/ShareLinkDispatcher';
import { ShareLinkInvalidCard } from '../share-link/ShareLinkInvalidCard';

const inputClassName = 'w-full min-w-0';

interface CampConversionCreated {
  conversionToken: string;
  expiresAt: string;
  joinUrl: string;
}

type EmailLinkStatus = 'idle' | 'sending' | 'sent' | 'error';

export interface CampSignupFlowProps {
  code: string;
}

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) {
    return null;
  }
  return (
    <p id={id} role="alert" className="text-caption text-danger">
      {message}
    </p>
  );
}

// Stand-in for the Epic-08 camp / evaluation form: collects the contact + player data, stores it as a
// camp conversion (POST /camp-conversions) and then offers to create the account straight away (pre-filled
// registration) or to email the join link for later.
export function CampSignupFlow({ code }: CampSignupFlowProps) {
  const [preview, setPreview] = useState<ShareLinkPreviewResponse | 'pending' | 'error'>('pending');
  const [created, setCreated] = useState<{ conversion: CampConversionCreated; email: string } | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [retryAfterSeconds, setRetryAfterSeconds] = useState<number | null>(null);
  const [rateLimited, setRateLimited] = useState(false);
  const [emailStatus, setEmailStatus] = useState<EmailLinkStatus>('idle');

  const {
    register,
    handleSubmit,
    control,
    formState: { errors, isSubmitting },
  } = useForm<CampSignupFormValues>({
    resolver: zodResolver(campSignupSchema),
    mode: 'onTouched',
    defaultValues: {
      parentFirstName: '',
      parentLastName: '',
      email: '',
      phone: '',
      playerName: '',
      playerAge: '',
      playerGender: '' as CampSignupFormValues['playerGender'],
      source: 'CAMP',
    },
  });

  useEffect(() => {
    let cancelled = false;
    publicApiRequest(`/share-links/${encodeURIComponent(code)}`)
      .then(async (res) => {
        if (!cancelled) {
          setPreview(res.ok ? ((await res.json()) as ShareLinkPreviewResponse) : 'error');
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPreview('error');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [code]);

  const submit = handleSubmit(async (values) => {
    setSubmitError(null);
    setRateLimited(false);

    let res: Response;
    try {
      res = await publicApiRequest('/camp-conversions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shareLinkCode: code,
          parentFirstName: values.parentFirstName,
          parentLastName: values.parentLastName,
          email: values.email,
          phone: values.phone,
          playerName: values.playerName,
          playerAge: Number(values.playerAge),
          playerGender: values.playerGender,
          source: values.source,
        }),
      });
    } catch {
      setSubmitError('Something went wrong. Please try again.');
      return;
    }

    if (res.status === 429) {
      setRetryAfterSeconds(readRetryAfterSeconds(res));
      setRateLimited(true);
      return;
    }
    if (!res.ok) {
      const body = await parseApiErrorBody(res);
      setSubmitError(body?.message ?? 'Something went wrong. Please try again.');
      return;
    }

    setCreated({ conversion: (await res.json()) as CampConversionCreated, email: values.email });
  });

  async function emailTheLink(token: string) {
    setEmailStatus('sending');
    try {
      const res = await publicApiRequest(`/camp-conversions/${encodeURIComponent(token)}/email-link`, { method: 'POST' });
      setEmailStatus(res.ok ? 'sent' : 'error');
    } catch {
      setEmailStatus('error');
    }
  }

  if (preview === 'pending') {
    return (
      <div role="status" aria-live="polite" className="text-body text-text-secondary">
        Loading sign-up…
      </div>
    );
  }

  if (preview === 'error') {
    return <ShareLinkInvalidCard />;
  }

  if (!preview.valid || preview.type !== 'PLAYER_STATIC') {
    return <ShareLinkInvalidCard reason={preview.valid ? 'NOT_FOUND' : preview.reason} />;
  }

  if (created) {
    const joinHref = `/join/${encodeURIComponent(code)}?camp=${encodeURIComponent(created.conversion.conversionToken)}`;
    return (
      <div className="flex flex-col gap-md" data-testid="camp-success">
        <h2 className="font-display text-section-title text-ink">Thanks!</h2>
        <p className="text-body text-text-primary">Create your PracticePerfect account to see schedules.</p>
        <p className="text-body text-ink-muted">
          We already have your details from the sign-up - you will only need to choose a password.
        </p>

        <Link href={joinHref} className="btn btn-primary btn-lg w-full text-center">
          Create account now
        </Link>

        {emailStatus === 'sent' ? (
          <p role="status" className="text-body text-text-primary">
            We emailed the link to {created.email}. Use it any time in the next 7 days to finish creating your account.
          </p>
        ) : (
          <>
            <button
              type="button"
              className="btn btn-secondary btn-lg w-full"
              disabled={emailStatus === 'sending'}
              onClick={() => void emailTheLink(created.conversion.conversionToken)}
            >
              {emailStatus === 'sending' ? 'Sending…' : 'Email me the link for later'}
            </button>
            {emailStatus === 'error' && (
              <p role="alert" className="text-body text-danger">
                We could not send the email. Please try again.
              </p>
            )}
          </>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate className="flex w-full flex-col gap-md">
      {preview.trainerDisplayName && (
        <p className="text-body text-ink-muted">
          Signing up with <strong className="text-ink">{preview.trainerDisplayName}</strong>.
        </p>
      )}

      <div className="flex flex-col gap-xxs">
        <label htmlFor="camp-source" className="field-label">
          This sign-up is for
        </label>
        <select id="camp-source" className={inputClassName} {...register('source')}>
          <option value="CAMP">A camp</option>
          <option value="EVALUATION">An evaluation</option>
        </select>
      </div>

      <div className="flex flex-wrap gap-md">
        <div className="flex min-w-0 flex-[1_1_11rem] flex-col gap-xxs">
          <label htmlFor="camp-parent-first-name" className="field-label">
            Your first name
          </label>
          <input
            id="camp-parent-first-name"
            type="text"
            autoComplete="given-name"
            className={inputClassName}
            aria-invalid={!!errors.parentFirstName}
            aria-describedby={errors.parentFirstName ? 'camp-parent-first-name-error' : undefined}
            {...register('parentFirstName')}
          />
          <FieldError id="camp-parent-first-name-error" message={errors.parentFirstName?.message} />
        </div>
        <div className="flex min-w-0 flex-[1_1_11rem] flex-col gap-xxs">
          <label htmlFor="camp-parent-last-name" className="field-label">
            Your last name
          </label>
          <input
            id="camp-parent-last-name"
            type="text"
            autoComplete="family-name"
            className={inputClassName}
            aria-invalid={!!errors.parentLastName}
            aria-describedby={errors.parentLastName ? 'camp-parent-last-name-error' : undefined}
            {...register('parentLastName')}
          />
          <FieldError id="camp-parent-last-name-error" message={errors.parentLastName?.message} />
        </div>
      </div>

      <div className="flex flex-col gap-xxs">
        <label htmlFor="camp-email" className="field-label">
          Email
        </label>
        <input
          id="camp-email"
          type="email"
          inputMode="email"
          placeholder="you@example.com"
          autoComplete="email"
          className={inputClassName}
          aria-invalid={!!errors.email}
          aria-describedby={errors.email ? 'camp-email-error' : undefined}
          {...register('email')}
        />
        <FieldError id="camp-email-error" message={errors.email?.message} />
      </div>

      <div className="flex flex-col gap-xxs">
        <label htmlFor="camp-phone" className="field-label">
          Phone number
        </label>
        <Controller
          control={control}
          name="phone"
          render={({ field }) => (
            <PhoneInput
              id="camp-phone"
              value={field.value}
              onChange={field.onChange}
              onBlur={field.onBlur}
              className={inputClassName}
              aria-invalid={!!errors.phone}
              aria-describedby={errors.phone ? 'camp-phone-error' : undefined}
            />
          )}
        />
        <FieldError id="camp-phone-error" message={errors.phone?.message} />
      </div>

      <div className="flex flex-col gap-xxs">
        <label htmlFor="camp-player-name" className="field-label">
          Player&apos;s name
        </label>
        <input
          id="camp-player-name"
          type="text"
          autoComplete="off"
          className={inputClassName}
          aria-invalid={!!errors.playerName}
          aria-describedby={errors.playerName ? 'camp-player-name-error' : undefined}
          {...register('playerName')}
        />
        <FieldError id="camp-player-name-error" message={errors.playerName?.message} />
      </div>

      <div className="flex flex-wrap gap-md">
        <div className="flex min-w-0 flex-[1_1_11rem] flex-col gap-xxs">
          <label htmlFor="camp-player-age" className="field-label">
            Player&apos;s age
          </label>
          <input
            id="camp-player-age"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            className={inputClassName}
            aria-invalid={!!errors.playerAge}
            aria-describedby={errors.playerAge ? 'camp-player-age-error' : undefined}
            {...register('playerAge')}
          />
          <FieldError id="camp-player-age-error" message={errors.playerAge?.message} />
        </div>
        <div className="flex min-w-0 flex-[1_1_11rem] flex-col gap-xxs">
          <label htmlFor="camp-player-gender" className="field-label">
            Gender
          </label>
          <select
            id="camp-player-gender"
            className={inputClassName}
            aria-invalid={!!errors.playerGender}
            aria-describedby={errors.playerGender ? 'camp-player-gender-error' : undefined}
            {...register('playerGender')}
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
          <FieldError id="camp-player-gender-error" message={errors.playerGender?.message} />
        </div>
      </div>

      {rateLimited && <RateLimitNotice retryAfterSeconds={retryAfterSeconds} />}
      {submitError && (
        <p role="alert" className="text-body text-danger">
          {submitError}
        </p>
      )}

      <button type="submit" disabled={isSubmitting} className="btn btn-primary btn-lg w-full">
        {isSubmitting ? 'Submitting…' : 'Submit sign-up'}
      </button>
    </form>
  );
}
