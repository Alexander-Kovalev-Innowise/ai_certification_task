'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

import { publicApiRequest } from '../../lib/api/apiClient';
import { parseApiErrorBody, readRetryAfterSeconds } from '../../lib/api/apiError';
import { toAuthSession } from '../../lib/api/authSession';
import { safeNextPath } from '../../lib/safeNextPath';
import { loginSchema, type LoginFormValues } from '../../lib/schemas/loginSchema';
import { useAuthStore } from '../../stores/useAuthStore';
import type { AuthSessionResponseDto } from '../../types/auth';
import { NavIcon } from '../shell/NavIcon';

import { RateLimitNotice } from './RateLimitNotice';

// api §1 LoginDto's anti-enumeration posture: "Invalid email or password."
// covers both "no such user" and "wrong password" identically. fe §4.1's one
// documented exception — ACCOUNT_INACTIVE gets FR-013's exact copy instead,
// since the *UI* is allowed to be specific once it already has the errorCode
// (the network-level 401 stays generic either way).
const GENERIC_INVALID_CREDENTIALS = 'Invalid email or password.';
const ACCOUNT_INACTIVE_MESSAGE = 'Account deactivated. Contact support.';

const INPUT_CLASSNAME =
  'w-full min-w-0';

const CHANGE_PASSWORD_PATH = '/change-password';
const DASHBOARD_PATH = '/dashboard';

export interface LoginFormProps {
  /** Post-login destination from the `?next=` query param; honored only if it is a same-origin relative path (see `safeNextPath`). */
  next?: string | null;
}

export function LoginForm({ next = null }: LoginFormProps = {}) {
  const router = useRouter();
  const setSession = useAuthStore((state) => state.setSession);
  const [formError, setFormError] = useState<string | null>(null);
  const [retryAfterSeconds, setRetryAfterSeconds] = useState<number | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    mode: 'onTouched',
    defaultValues: { email: '', password: '' },
  });

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
    // landing BEFORE any role dashboard is ever touched — it wins over a
    // `next` target too. Otherwise a safe `next` (e.g. back to /join/<code>)
    // beats the default dashboard.
    router.push(session.user.mustChangePassword ? CHANGE_PASSWORD_PATH : (safeNextPath(next) ?? DASHBOARD_PATH));
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-md">
      <div className="flex flex-col gap-xxs">
        <label htmlFor="login-email" className="field-label">
          Email
        </label>
        <div className="relative">
          <span aria-hidden="true" className="pointer-events-none absolute left-md top-1/2 flex -translate-y-1/2 text-text-subtle">
            <NavIcon name="mail" size={18} />
          </span>
          <input
            id="login-email"
            type="email"
            inputMode="email"
            placeholder="you@example.com"
            autoComplete="email"
            className={`${INPUT_CLASSNAME} pl-[2.75rem]`}
            aria-invalid={!!errors.email}
            aria-describedby={errors.email ? 'login-email-error' : undefined}
            {...register('email')}
          />
        </div>
        {errors.email && (
          <p id="login-email-error" role="alert" className="text-caption text-danger">
            {errors.email.message}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-xxs">
        <label htmlFor="login-password" className="field-label">
          Password
        </label>
        <div className="relative">
          <span aria-hidden="true" className="pointer-events-none absolute left-md top-1/2 flex -translate-y-1/2 text-text-subtle">
            <NavIcon name="lock" size={18} />
          </span>
          <input
            id="login-password"
            type={showPassword ? 'text' : 'password'}
            placeholder="Your password"
            autoComplete="current-password"
            className={`${INPUT_CLASSNAME} pl-[2.75rem] pr-[2.75rem]`}
            aria-invalid={!!errors.password}
            aria-describedby={errors.password ? 'login-password-error' : undefined}
            {...register('password')}
          />
          <button
            type="button"
            onClick={() => setShowPassword((value) => !value)}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            aria-pressed={showPassword}
            className="absolute right-xs top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-pill text-text-subtle transition-colors hover:text-ink"
          >
            <NavIcon name={showPassword ? 'eye-off' : 'eye'} size={18} />
          </button>
        </div>
        {errors.password && (
          <p id="login-password-error" role="alert" className="text-caption text-danger">
            {errors.password.message}
          </p>
        )}
      </div>

      {formError && (
        <p role="alert" className="text-body text-danger">
          {formError}
        </p>
      )}

      {retryAfterSeconds !== null && <RateLimitNotice retryAfterSeconds={retryAfterSeconds} />}

      <button
        type="submit"
        disabled={isSubmitting}
        className="btn btn-primary btn-lg mt-xs w-full"
      >
        {isSubmitting ? 'Signing in…' : 'Sign in'}
      </button>

      <Link href="/forgot-password" className="text-center text-caption text-text-secondary underline underline-offset-4 transition-colors hover:text-brand-primary">
        Forgot your password?
      </Link>
    </form>
  );
}
