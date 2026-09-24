'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { apiRequest } from '../../lib/api/apiClient';
import { parseApiErrorBody } from '../../lib/api/apiError';
import type { Role } from '../../types/auth';

import type { UserStatus } from './UsersTable';

// api §3 GET /users/:id — `UserDetailResponseDto` = `MeResponseDto` shape
// plus `status`, `lastLoginAt`, `deletedAt`.
export interface UserDetailResponseDto {
  id: string;
  email: string;
  role: Role;
  accountType: 'ADULT' | 'CHILD';
  firstName: string;
  lastName: string;
  phone: string | null;
  photoUrl: string | null;
  emailVerified: boolean;
  mustChangePassword: boolean;
  createdAt: string;
  status: UserStatus;
  lastLoginAt: string | null;
  deletedAt: string | null;
}

const userDetailFormSchema = z.object({
  firstName: z.string().min(1, 'First name is required.').max(100, 'First name must be 100 characters or fewer.'),
  lastName: z.string().min(1, 'Last name is required.').max(100, 'Last name must be 100 characters or fewer.'),
  phone: z.string().optional(),
});

type UserDetailFormValues = z.infer<typeof userDetailFormSchema>;

export interface UserDetailFormProps {
  user: UserDetailResponseDto;
  onSaved?: (updated: UserDetailResponseDto) => void;
}

const INPUT_CLASSNAME =
  'rounded-sm border border-[var(--border-soft)] bg-[var(--surface-1)] p-sm text-body text-[var(--text-primary)] outline-none focus:border-[var(--brand-primary)]';

// fe §4.3 — UserDetailForm: PATCH /users/:id (api §3 — a superset of
// UpdateMeDto; role changes are deliberately excluded from this DTO, BR-001
// single-role-per-user invariant). Read-only account fields (email, role,
// status, created date) sit alongside the editable name/phone fields.
// Task 12.5.
export function UserDetailForm({ user, onSaved }: UserDetailFormProps) {
  const [formError, setFormError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<UserDetailFormValues>({
    resolver: zodResolver(userDetailFormSchema),
    defaultValues: { firstName: user.firstName, lastName: user.lastName, phone: user.phone ?? '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    setSuccessMessage(null);

    const res = await apiRequest(`/users/${user.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ firstName: values.firstName, lastName: values.lastName, phone: values.phone || undefined }),
    });

    if (!res.ok) {
      await parseApiErrorBody(res);
      setFormError('Something went wrong saving this user. Please try again.');
      return;
    }

    const updated = (await res.json()) as UserDetailResponseDto;
    setSuccessMessage('Saved.');
    onSaved?.(updated);
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-md">
      <dl className="grid grid-cols-2 gap-sm text-body text-[var(--text-secondary)]">
        <div>
          <dt className="text-caption">Email</dt>
          <dd className="text-[var(--text-primary)]">{user.email}</dd>
        </div>
        <div>
          <dt className="text-caption">Role</dt>
          <dd className="text-[var(--text-primary)]">{user.role}</dd>
        </div>
        <div>
          <dt className="text-caption">Status</dt>
          <dd className="text-[var(--text-primary)]">{user.status}</dd>
        </div>
        <div>
          <dt className="text-caption">Created</dt>
          <dd className="text-[var(--text-primary)]">{new Date(user.createdAt).toLocaleDateString()}</dd>
        </div>
      </dl>

      <div className="flex flex-col gap-xxs">
        <label htmlFor="user-detail-first-name" className="text-body text-[var(--text-secondary)]">
          First name
        </label>
        <input
          id="user-detail-first-name"
          className={INPUT_CLASSNAME}
          aria-invalid={!!errors.firstName}
          aria-describedby={errors.firstName ? 'user-detail-first-name-error' : undefined}
          {...register('firstName')}
        />
        {errors.firstName && (
          <p id="user-detail-first-name-error" role="alert" className="text-caption text-[var(--danger)]">
            {errors.firstName.message}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-xxs">
        <label htmlFor="user-detail-last-name" className="text-body text-[var(--text-secondary)]">
          Last name
        </label>
        <input
          id="user-detail-last-name"
          className={INPUT_CLASSNAME}
          aria-invalid={!!errors.lastName}
          aria-describedby={errors.lastName ? 'user-detail-last-name-error' : undefined}
          {...register('lastName')}
        />
        {errors.lastName && (
          <p id="user-detail-last-name-error" role="alert" className="text-caption text-[var(--danger)]">
            {errors.lastName.message}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-xxs">
        <label htmlFor="user-detail-phone" className="text-body text-[var(--text-secondary)]">
          Phone
        </label>
        <input id="user-detail-phone" type="tel" className={INPUT_CLASSNAME} {...register('phone')} />
      </div>

      {formError && (
        <p role="alert" className="text-body text-[var(--danger)]">
          {formError}
        </p>
      )}
      {successMessage && (
        <p role="status" className="text-body text-[var(--success)]">
          {successMessage}
        </p>
      )}

      <button
        type="submit"
        disabled={isSubmitting}
        className="self-start rounded-sm bg-[var(--brand-primary)] p-sm text-body font-semibold text-[#0D0D0D] shadow-button-primary disabled:opacity-60"
      >
        {isSubmitting ? 'Saving…' : 'Save changes'}
      </button>
    </form>
  );
}
