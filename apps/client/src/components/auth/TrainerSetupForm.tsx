'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

import { publicApiRequest } from '../../lib/api/apiClient';
import { toAuthSession } from '../../lib/api/authSession';
import { completeTrainerSetupSchema, type CompleteTrainerSetupFormValues } from '../../lib/schemas/completeTrainerSetupSchema';
import { useAuthStore } from '../../stores/useAuthStore';
import type { AuthSessionResponseDto } from '../../types/auth';

const CHANGE_PASSWORD_PATH = '/change-password';
const DASHBOARD_PATH = '/dashboard';

const INPUT_CLASSNAME =
  'w-full min-w-0';

// fe §4.1 "/register?token=" (api §1 POST /auth/register,
// CompleteTrainerSetupDto) — NOT public self-registration (BR-005): a
// Super-Admin-provisioned trainer completing their own setup link. Same
// 404/410 "invalid or expired" handling as ResetPasswordForm. On success
// the response already sets cookies server-side and returns an
// AuthSessionResponseDto — the client just needs to populate
// useAuthStore, exactly like a normal login.
function InvalidOrExpiredLink() {
  return (
    <p role="alert" className="text-body text-text-primary">
      This link is invalid or has expired.
    </p>
  );
}

type Status = 'form' | 'submitting' | 'invalid' | 'error';

export function TrainerSetupForm() {
  const router = useRouter();
  const token = useSearchParams().get('token');
  const setSession = useAuthStore((state) => state.setSession);
  const [status, setStatus] = useState<Status>(token ? 'form' : 'invalid');

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<CompleteTrainerSetupFormValues>({
    resolver: zodResolver(completeTrainerSetupSchema),
    mode: 'onTouched',
    defaultValues: { password: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    if (!token) {
      setStatus('invalid');
      return;
    }

    setStatus('submitting');

    const res = await publicApiRequest('/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ setupToken: token, password: values.password }),
    });

    // 409 = the one-time setup link was already used (POST /auth/register).
    if (res.status === 404 || res.status === 409 || res.status === 410) {
      setStatus('invalid');
      return;
    }

    if (!res.ok) {
      setStatus('error');
      return;
    }

    const session = (await res.json()) as AuthSessionResponseDto;
    setSession(toAuthSession(session));
    router.push(session.user.mustChangePassword ? CHANGE_PASSWORD_PATH : DASHBOARD_PATH);
  });

  if (status === 'invalid') {
    return <InvalidOrExpiredLink />;
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-md">
      <div className="flex flex-col gap-xxs">
        <label htmlFor="trainer-setup-password" className="field-label">
          Choose a password
        </label>
        <input
          id="trainer-setup-password"
          type="password"
          placeholder="At least 8 characters"
          autoComplete="new-password"
          className={INPUT_CLASSNAME}
          aria-invalid={!!errors.password}
          aria-describedby={errors.password ? 'trainer-setup-password-error' : undefined}
          {...register('password')}
        />
        {errors.password && (
          <p id="trainer-setup-password-error" role="alert" className="text-caption text-danger">
            {errors.password.message}
          </p>
        )}
      </div>

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
        {status === 'submitting' ? 'Setting up…' : 'Complete setup'}
      </button>
    </form>
  );
}
