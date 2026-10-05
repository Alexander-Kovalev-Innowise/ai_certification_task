'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

import { publicApiRequest } from '../../lib/api/apiClient';
import { readRetryAfterSeconds } from '../../lib/api/apiError';
import { resetPasswordSchema, type ResetPasswordFormValues } from '../../lib/schemas/resetPasswordSchema';

import { RateLimitNotice } from './RateLimitNotice';

const INPUT_CLASSNAME =
  'w-full min-w-0';

// fe §4.1 "/reset-password?token=" — 404/410 both render this same distinct
// copy, linking back to /forgot-password rather than a generic error page.
// A missing token in the URL (no ?token= at all) is treated identically —
// there is nothing valid to submit either way.
function InvalidOrExpiredLink() {
  return (
    <div className="flex flex-col gap-sm">
      <p role="alert" className="text-body text-text-primary">
        This link is invalid or has expired.
      </p>
      <Link href="/forgot-password" className="text-body text-brand-primary underline">
        Request a new link
      </Link>
    </div>
  );
}

type Status = 'form' | 'submitting' | 'success' | 'invalid' | 'rate-limited' | 'error';

export function ResetPasswordForm() {
  const token = useSearchParams().get('token');
  const [status, setStatus] = useState<Status>(token ? 'form' : 'invalid');
  const [retryAfterSeconds, setRetryAfterSeconds] = useState<number | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ResetPasswordFormValues>({
    resolver: zodResolver(resetPasswordSchema),
    mode: 'onTouched',
    defaultValues: { newPassword: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    if (!token) {
      setStatus('invalid');
      return;
    }

    setStatus('submitting');

    const res = await publicApiRequest('/auth/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, newPassword: values.newPassword }),
    });

    if (res.status === 404 || res.status === 410) {
      setStatus('invalid');
      return;
    }

    if (res.status === 429) {
      setRetryAfterSeconds(readRetryAfterSeconds(res));
      setStatus('rate-limited');
      return;
    }

    setStatus(res.ok ? 'success' : 'error');
  });

  if (status === 'invalid') {
    return <InvalidOrExpiredLink />;
  }

  if (status === 'success') {
    return (
      <div className="flex flex-col gap-sm">
        <p role="status" className="text-body text-text-primary">
          Your password has been reset. You can now sign in.
        </p>
        <Link href="/login" className="text-body text-brand-primary underline">
          Go to sign in
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-md">
      <div className="flex flex-col gap-xxs">
        <label htmlFor="reset-password-new-password" className="field-label">
          New password
        </label>
        <input
          id="reset-password-new-password"
          type="password"
          placeholder="At least 8 characters"
          autoComplete="new-password"
          className={INPUT_CLASSNAME}
          aria-invalid={!!errors.newPassword}
          aria-describedby={errors.newPassword ? 'reset-password-new-password-error' : undefined}
          {...register('newPassword')}
        />
        {errors.newPassword && (
          <p id="reset-password-new-password-error" role="alert" className="text-caption text-danger">
            {errors.newPassword.message}
          </p>
        )}
      </div>

      {status === 'rate-limited' && <RateLimitNotice retryAfterSeconds={retryAfterSeconds} />}
      {status === 'error' && (
        <p role="alert" className="text-body text-danger">
          Something went wrong. Please try again.
        </p>
      )}

      <button
        type="submit"
        disabled={status === 'submitting'}
        className="btn btn-primary"
      >
        {status === 'submitting' ? 'Resetting…' : 'Reset password'}
      </button>
    </form>
  );
}
