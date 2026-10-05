'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';

import { publicApiRequest } from '../../lib/api/apiClient';
import { parseApiErrorBody } from '../../lib/api/apiError';
import { buildChangePasswordSchema, type ChangePasswordFormValues } from '../../lib/schemas/changePasswordSchema';
import { useAuthStore } from '../../stores/useAuthStore';

const LOGIN_PATH = '/login';

const INPUT_CLASSNAME =
  'w-full min-w-0';

/**
 * fe §4.7 / Task 11.6 — dual-mode: mounted both as the forced landing
 * (`/change-password`, `mustChangePassword: true`) and later reused
 * voluntarily from `/account/profile` (Task 18.1). Mode is derived from the
 * CURRENT session's `user.mustChangePassword`, not a prop passed in by the
 * page, so both mount sites get the right behavior automatically.
 * `currentPassword` is omitted entirely (not shown-and-disabled) on the
 * forced path, matching the DTO's `currentPassword?` optionality (api §1).
 *
 * IMPORTANT finding (verified against
 * apps/server/src/modules/auth/auth.service.ts AuthService.changePassword):
 * a successful change bumps `tokenVersion` and revokes every refresh token
 * for this user — the same "logout everywhere" side effect a password
 * reset has. The access token this very request was authenticated with is
 * therefore invalidated by the call that just used it. Patching
 * `mustChangePassword: false` onto the existing in-memory session and
 * pushing straight to /dashboard would just bounce through a broken
 * `GET /me/bootstrap` 401 → failed silent-refresh → forced /login anyway
 * (apiRequest's own retry/redirect logic, fe §6.2) — a confusing detour.
 * This form instead clears the session itself and sends the user straight
 * to /login to sign in fresh with the new password.
 */
export function ChangePasswordForm() {
  const router = useRouter();
  const user = useAuthStore((state) => state.user);
  const clearSession = useAuthStore((state) => state.clear);
  const requireCurrentPassword = user ? !user.mustChangePassword : true;
  const schema = useMemo(() => buildChangePasswordSchema(requireCurrentPassword), [requireCurrentPassword]);

  const [status, setStatus] = useState<'form' | 'submitting' | 'success'>('form');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ChangePasswordFormValues>({
    resolver: zodResolver(schema),
    mode: 'onTouched',
    defaultValues: { currentPassword: '', newPassword: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    setStatus('submitting');
    setErrorMessage(null);

    const body: { currentPassword?: string; newPassword: string } = { newPassword: values.newPassword };
    if (requireCurrentPassword) {
      body.currentPassword = values.currentPassword;
    }

    const res = await publicApiRequest('/auth/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errorBody = await parseApiErrorBody(res);
      setErrorMessage(
        res.status === 401
          ? 'Current password is incorrect.'
          : (errorBody?.message ?? 'Something went wrong. Please try again.'),
      );
      setStatus('form');
      return;
    }

    setStatus('success');
    clearSession();
    router.push(LOGIN_PATH);
  });

  if (status === 'success') {
    return (
      <p role="status" className="text-body text-text-primary">
        Password changed. Please sign in again.
      </p>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-md">
      {requireCurrentPassword && (
        <div className="flex flex-col gap-xxs">
          <label htmlFor="change-password-current" className="field-label">
            Current password
          </label>
          <input
            id="change-password-current"
            type="password"
            placeholder="Your current password"
            autoComplete="current-password"
            className={INPUT_CLASSNAME}
            aria-invalid={!!errors.currentPassword}
            aria-describedby={errors.currentPassword ? 'change-password-current-error' : undefined}
            {...register('currentPassword')}
          />
          {errors.currentPassword && (
            <p id="change-password-current-error" role="alert" className="text-caption text-danger">
              {errors.currentPassword.message}
            </p>
          )}
        </div>
      )}

      <div className="flex flex-col gap-xxs">
        <label htmlFor="change-password-new" className="field-label">
          New password
        </label>
        <input
          id="change-password-new"
          type="password"
          placeholder="At least 8 characters"
          autoComplete="new-password"
          className={INPUT_CLASSNAME}
          aria-invalid={!!errors.newPassword}
          aria-describedby={errors.newPassword ? 'change-password-new-error' : undefined}
          {...register('newPassword')}
        />
        {errors.newPassword && (
          <p id="change-password-new-error" role="alert" className="text-caption text-danger">
            {errors.newPassword.message}
          </p>
        )}
      </div>

      {errorMessage && (
        <p role="alert" className="text-body text-danger">
          {errorMessage}
        </p>
      )}

      <button
        type="submit"
        disabled={status === 'submitting'}
        className="btn btn-primary"
      >
        {status === 'submitting' ? 'Changing…' : 'Change password'}
      </button>
    </form>
  );
}
