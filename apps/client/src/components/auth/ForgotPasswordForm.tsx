'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

import { publicApiRequest } from '../../lib/api/apiClient';
import { readRetryAfterSeconds } from '../../lib/api/apiError';
import { forgotPasswordSchema, type ForgotPasswordFormValues } from '../../lib/schemas/forgotPasswordSchema';

import { RateLimitNotice } from './RateLimitNotice';

const INPUT_CLASSNAME =
  'w-full min-w-0';

// fe §4.1 / api §1 — the server ALWAYS 202s with the identical message
// whether or not the email exists (FR-002 anti-enumeration). The client
// must resist "being helpful": this exact copy renders on every successful
// submission, never anything derived from the response body's content.
const SUCCESS_MESSAGE = "If that email exists, we've sent a link to reset your password.";

type Status = 'idle' | 'submitting' | 'sent' | 'rate-limited' | 'error';

export function ForgotPasswordForm() {
  const [status, setStatus] = useState<Status>('idle');
  const [retryAfterSeconds, setRetryAfterSeconds] = useState<number | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ForgotPasswordFormValues>({
    resolver: zodResolver(forgotPasswordSchema),
    mode: 'onTouched',
    defaultValues: { email: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    setStatus('submitting');

    let res: Response;
    try {
      res = await publicApiRequest('/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
    } catch {
      setStatus('error');
      return;
    }

    if (res.status === 429) {
      setRetryAfterSeconds(readRetryAfterSeconds(res));
      setStatus('rate-limited');
      return;
    }

    // api §1 — 202 always, regardless of whether the email is real. Any
    // other non-2xx here is a genuine transport/server failure, not an
    // enumeration signal, so it's fine to show a distinct (still
    // content-blind) error state for it.
    setStatus(res.ok ? 'sent' : 'error');
  });

  if (status === 'sent') {
    return (
      <p role="status" className="text-body text-text-primary">
        {SUCCESS_MESSAGE}
      </p>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-md">
      <div className="flex flex-col gap-xxs">
        <label htmlFor="forgot-password-email" className="field-label">
          Email
        </label>
        <input
          id="forgot-password-email"
          type="email"
          inputMode="email"
          placeholder="you@example.com"
          autoComplete="email"
          className={INPUT_CLASSNAME}
          aria-invalid={!!errors.email}
          aria-describedby={errors.email ? 'forgot-password-email-error' : undefined}
          {...register('email')}
        />
        {errors.email && (
          <p id="forgot-password-email-error" role="alert" className="text-caption text-danger">
            {errors.email.message}
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
        className="btn btn-primary btn-lg mt-xs w-full"
      >
        {status === 'submitting' ? 'Sending…' : 'Send reset link'}
      </button>

      <Link href="/login" className="text-center text-caption text-text-secondary underline underline-offset-4 transition-colors hover:text-brand-primary">
        Back to sign in
      </Link>
    </form>
  );
}
