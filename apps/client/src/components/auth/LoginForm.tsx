'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

import { publicApiRequest } from '../../lib/api/apiClient';
import { parseApiErrorBody, readRetryAfterSeconds } from '../../lib/api/apiError';
import { toAuthSession } from '../../lib/api/authSession';
import { loginSchema, type LoginFormValues } from '../../lib/schemas/loginSchema';
import { useAuthStore } from '../../stores/useAuthStore';
import type { AuthSessionResponseDto } from '../../types/auth';

import { RateLimitNotice } from './RateLimitNotice';

// api §1 LoginDto's anti-enumeration posture: "Invalid email or password."
// covers both "no such user" and "wrong password" identically. fe §4.1's one
// documented exception — ACCOUNT_INACTIVE gets FR-013's exact copy instead,
// since the *UI* is allowed to be specific once it already has the errorCode
// (the network-level 401 stays generic either way).
const GENERIC_INVALID_CREDENTIALS = 'Invalid email or password.';
const ACCOUNT_INACTIVE_MESSAGE = 'Account deactivated. Contact support.';

const CHANGE_PASSWORD_PATH = '/change-password';
const DASHBOARD_PATH = '/dashboard';

export function LoginForm() {
  const router = useRouter();
  const setSession = useAuthStore((state) => state.setSession);
  const [formError, setFormError] = useState<string | null>(null);
  const [retryAfterSeconds, setRetryAfterSeconds] = useState<number | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormValues>({ resolver: zodResolver(loginSchema) });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    setRetryAfterSeconds(null);

    const res = await publicApiRequest('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(values),
    });

    if (!res.ok) {
      if (res.status === 429) {
        setRetryAfterSeconds(readRetryAfterSeconds(res));
        return;
      }

      const errorBody = await parseApiErrorBody(res);
      setFormError(errorBody?.errorCode === 'ACCOUNT_INACTIVE' ? ACCOUNT_INACTIVE_MESSAGE : GENERIC_INVALID_CREDENTIALS);
      return;
    }

    const session = (await res.json()) as AuthSessionResponseDto;
    setSession(toAuthSession(session));

    // fe §4.1 Task 11.1 "Do" — mustChangePassword redirects to the forced
    // landing BEFORE any role dashboard is ever touched.
    router.push(session.user.mustChangePassword ? CHANGE_PASSWORD_PATH : DASHBOARD_PATH);
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-md">
      <div className="flex flex-col gap-xxs">
        <label htmlFor="login-email" className="text-body text-[var(--text-secondary)]">
          Email
        </label>
        <input
          id="login-email"
          type="email"
          autoComplete="email"
          className="rounded-sm border border-[var(--border-soft)] bg-[var(--surface-1)] p-sm text-body text-[var(--text-primary)] outline-none focus:border-[var(--brand-primary)]"
          aria-invalid={!!errors.email}
          aria-describedby={errors.email ? 'login-email-error' : undefined}
          {...register('email')}
        />
        {errors.email && (
          <p id="login-email-error" role="alert" className="text-caption text-[var(--danger)]">
            {errors.email.message}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-xxs">
        <label htmlFor="login-password" className="text-body text-[var(--text-secondary)]">
          Password
        </label>
        <input
          id="login-password"
          type="password"
          autoComplete="current-password"
          className="rounded-sm border border-[var(--border-soft)] bg-[var(--surface-1)] p-sm text-body text-[var(--text-primary)] outline-none focus:border-[var(--brand-primary)]"
          aria-invalid={!!errors.password}
          aria-describedby={errors.password ? 'login-password-error' : undefined}
          {...register('password')}
        />
        {errors.password && (
          <p id="login-password-error" role="alert" className="text-caption text-[var(--danger)]">
            {errors.password.message}
          </p>
        )}
      </div>

      {formError && (
        <p role="alert" className="text-body text-[var(--danger)]">
          {formError}
        </p>
      )}

      {retryAfterSeconds !== null && <RateLimitNotice retryAfterSeconds={retryAfterSeconds} />}

      <button
        type="submit"
        disabled={isSubmitting}
        className="rounded-sm bg-[var(--brand-primary)] p-sm text-body font-semibold text-[#0D0D0D] shadow-button-primary disabled:opacity-60"
      >
        {isSubmitting ? 'Signing in…' : 'Sign in'}
      </button>

      <a href="/forgot-password" className="text-center text-caption text-[var(--text-secondary)] underline">
        Forgot your password?
      </a>
    </form>
  );
}
