'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

import { publicApiRequest } from '../../lib/api/apiClient';
import { readRetryAfterSeconds } from '../../lib/api/apiError';
import { resetPasswordSchema, type ResetPasswordFormValues } from '../../lib/schemas/resetPasswordSchema';

import { RateLimitNotice } from './RateLimitNotice';

// fe §4.1 "/reset-password?token=" — 404/410 both render this same distinct
// copy, linking back to /forgot-password rather than a generic error page.
// A missing token in the URL (no ?token= at all) is treated identically —
// there is nothing valid to submit either way.
function InvalidOrExpiredLink() {
  return (
    <div className="flex flex-col gap-sm">
      <p role="alert" className="text-body text-[var(--text-primary)]">
        This link is invalid or has expired.
      </p>
      <a href="/forgot-password" className="text-body text-[var(--brand-primary)] underline">
        Request a new link
      </a>
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
  } = useForm<ResetPasswordFormValues>({ resolver: zodResolver(resetPasswordSchema) });

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
        <p role="status" className="text-body text-[var(--text-primary)]">
          Your password has been reset. You can now sign in.
        </p>
        <a href="/login" className="text-body text-[var(--brand-primary)] underline">
          Go to sign in
        </a>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-md">
      <div className="flex flex-col gap-xxs">
        <label htmlFor="reset-password-new-password" className="text-body text-[var(--text-secondary)]">
          New password
        </label>
        <input
          id="reset-password-new-password"
          type="password"
          autoComplete="new-password"
          className="rounded-sm border border-[var(--border-soft)] bg-[var(--surface-1)] p-sm text-body text-[var(--text-primary)] outline-none focus:border-[var(--brand-primary)]"
          aria-invalid={!!errors.newPassword}
          aria-describedby={errors.newPassword ? 'reset-password-new-password-error' : undefined}
          {...register('newPassword')}
        />
        {errors.newPassword && (
          <p id="reset-password-new-password-error" role="alert" className="text-caption text-[var(--danger)]">
            {errors.newPassword.message}
          </p>
        )}
      </div>

      {status === 'rate-limited' && <RateLimitNotice retryAfterSeconds={retryAfterSeconds} />}
      {status === 'error' && (
        <p role="alert" className="text-body text-[var(--danger)]">
          Something went wrong. Please try again.
        </p>
      )}

      <button
        type="submit"
        disabled={status === 'submitting'}
        className="rounded-sm bg-[var(--brand-primary)] p-sm text-body font-semibold text-[#0D0D0D] shadow-button-primary disabled:opacity-60"
      >
        {status === 'submitting' ? 'Resetting…' : 'Reset password'}
      </button>
    </form>
  );
}
