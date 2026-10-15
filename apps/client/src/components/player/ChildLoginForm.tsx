'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

import { apiRequest } from '../../lib/api/apiClient';
import {
  createChildLoginSchema,
  resetChildLoginPasswordSchema,
  type CreateChildLoginFormValues,
  type ResetChildLoginPasswordFormValues,
} from '../../lib/schemas/childLoginSchema';
import { Card, CardHeader } from '../shared/Card';

export interface ChildLoginFormProps {
  profileId: string;
  childName: string;
  /** `true` when the profile already has its own login (`childUserId` set) — shows the reset-password form instead. */
  hasLogin: boolean;
  /** Called after a login was created, so the page can refetch the profile. */
  onCreated: () => void;
}

const DUPLICATE_MESSAGE = 'A user with this email already exists, or this child already has a login.';
const GENERIC_ERROR = 'Something went wrong. Please try again.';

function CreateLoginFields({ profileId, onCreated }: Pick<ChildLoginFormProps, 'profileId' | 'onCreated'>) {
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<CreateChildLoginFormValues>({
    resolver: zodResolver(createChildLoginSchema),
    mode: 'onTouched',
    defaultValues: { email: '', password: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    const res = await apiRequest(`/player-profiles/${profileId}/child-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(values),
    });
    if (res.status === 409) {
      setFormError(DUPLICATE_MESSAGE);
      return;
    }
    if (!res.ok) {
      setFormError(GENERIC_ERROR);
      return;
    }
    onCreated();
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-md">
      <div className="flex flex-col gap-xxs">
        <label htmlFor="child-login-email" className="field-label">
          Child&apos;s sign-in email
        </label>
        <input
          id="child-login-email"
          type="email"
          placeholder="alex@example.com"
          autoComplete="off"
          className="w-full min-w-0"
          aria-invalid={!!errors.email}
          aria-describedby={errors.email ? 'child-login-email-error' : undefined}
          {...register('email')}
        />
        {errors.email && (
          <p id="child-login-email-error" role="alert" className="text-caption text-danger">
            {errors.email.message}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-xxs">
        <label htmlFor="child-login-password" className="field-label">
          Initial password
        </label>
        <input
          id="child-login-password"
          type="password"
          placeholder="At least 8 characters"
          autoComplete="new-password"
          className="w-full min-w-0"
          aria-invalid={!!errors.password}
          aria-describedby={errors.password ? 'child-login-password-error' : undefined}
          {...register('password')}
        />
        {errors.password && (
          <p id="child-login-password-error" role="alert" className="text-caption text-danger">
            {errors.password.message}
          </p>
        )}
      </div>

      {formError && (
        <p role="alert" className="text-body text-danger">
          {formError}
        </p>
      )}

      <div>
        <button type="submit" disabled={isSubmitting} className="btn btn-primary">
          {isSubmitting ? 'Creating…' : 'Create login'}
        </button>
      </div>
    </form>
  );
}

function ResetPasswordFields({ profileId }: Pick<ChildLoginFormProps, 'profileId'>) {
  const [formError, setFormError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ResetChildLoginPasswordFormValues>({
    resolver: zodResolver(resetChildLoginPasswordSchema),
    mode: 'onTouched',
    defaultValues: { password: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    setSuccess(false);
    const res = await apiRequest(`/player-profiles/${profileId}/child-login/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(values),
    });
    if (!res.ok) {
      setFormError(GENERIC_ERROR);
      return;
    }
    reset();
    setSuccess(true);
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-md">
      <div className="flex flex-col gap-xxs">
        <label htmlFor="child-login-new-password" className="field-label">
          New password
        </label>
        <input
          id="child-login-new-password"
          type="password"
          placeholder="At least 8 characters"
          autoComplete="new-password"
          className="w-full min-w-0"
          aria-invalid={!!errors.password}
          aria-describedby={errors.password ? 'child-login-new-password-error' : undefined}
          {...register('password')}
        />
        {errors.password && (
          <p id="child-login-new-password-error" role="alert" className="text-caption text-danger">
            {errors.password.message}
          </p>
        )}
      </div>

      {formError && (
        <p role="alert" className="text-body text-danger">
          {formError}
        </p>
      )}
      {success && (
        <p role="status" className="text-body text-success">
          Password updated. Your child has been signed out everywhere.
        </p>
      )}

      <div>
        <button type="submit" disabled={isSubmitting} className="btn btn-secondary">
          {isSubmitting ? 'Saving…' : 'Reset password'}
        </button>
      </div>
    </form>
  );
}

// "Child login" card on /profiles/[id] (guardian only — the page hides it for
// CHILD sessions and for the guardian's own profile). Without a login yet it
// creates one (`POST /player-profiles/:id/child-login`); with one it offers a
// password reset.
export function ChildLoginForm({ profileId, childName, hasLogin, onCreated }: ChildLoginFormProps) {
  return (
    <Card aria-label="Child login">
      <CardHeader
        titleAs="h2"
        title="Child login"
        subtitle={
          hasLogin
            ? `${childName} can sign in with their own account. Purchases they request need your approval.`
            : `Give ${childName} their own sign-in so they can see their schedule and ask you to approve purchases.`
        }
      />
      {hasLogin ? <ResetPasswordFields profileId={profileId} /> : <CreateLoginFields profileId={profileId} onCreated={onCreated} />}
    </Card>
  );
}
