'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useState, type ReactNode } from 'react';
import { Controller, useForm } from 'react-hook-form';

import { apiRequest } from '../../lib/api/apiClient';
import { parseApiErrorBody } from '../../lib/api/apiError';
import { userDetailSchema, type UserDetailFormValues } from '../../lib/schemas/userDetailSchema';
import type { Role } from '../../types/auth';
import { Card, CardFooter, CardHeader, CardSection } from '../shared/Card';
import { PhoneInput } from '../shared/PhoneInput';

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

export interface UserDetailFormProps {
  user: UserDetailResponseDto;
  onSaved?: (updated: UserDetailResponseDto) => void;
  /** Footer action buttons (left group); must be type="button". Save is pinned right. */
  actions?: ReactNode;
}

const INPUT_CLASSNAME =
  'w-full min-w-0';

// fe §4.3 — UserDetailForm: renders the whole user card (header, Account,
// Profile, footer) around one <form id="user-detail-form">. PATCH /users/:id (api §3 — a superset of
// UpdateMeDto; role changes are deliberately excluded from this DTO, BR-001
// single-role-per-user invariant). Read-only account fields (email, role,
// status, created date) sit alongside the editable name/phone fields.
// Task 12.5.
export function UserDetailForm({ user, onSaved, actions }: UserDetailFormProps) {
  const [formError, setFormError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    control,
    formState: { errors, isSubmitting },
  } = useForm<UserDetailFormValues>({
    resolver: zodResolver(userDetailSchema),
    mode: 'onTouched',
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
    <Card className="flex flex-1 flex-col">
      <form id="user-detail-form" onSubmit={onSubmit} noValidate className="flex flex-1 flex-col">
        <CardHeader
          title={`${user.firstName} ${user.lastName}`}
          titleAs="h2"
          badge={
            <>
              <span className={`badge ${statusBadgeClassName(user.status)}`}>{user.status}</span>
              <span className="badge badge-neutral">{user.role}</span>
            </>
          }
        />

        <CardSection heading="Account">
          <dl className="grid grid-cols-1 gap-x-lg gap-y-md text-body sm:grid-cols-2">
            <AccountField label="Email">
              <span className="break-words">{user.email}</span>
            </AccountField>
            <AccountField label="Role">{user.role}</AccountField>
            <AccountField label="Status">{user.status}</AccountField>
            <AccountField label="Created">{new Date(user.createdAt).toLocaleDateString()}</AccountField>
            {user.lastLoginAt && <AccountField label="Last login">{new Date(user.lastLoginAt).toLocaleString()}</AccountField>}
          </dl>
        </CardSection>

        <CardSection heading="Profile">
          <div className="flex flex-wrap gap-md">
            <div className="flex min-w-0 flex-[1_1_11rem] flex-col gap-xxs">
              <label htmlFor="user-detail-first-name" className="field-label">
                First name
              </label>
              <input
                id="user-detail-first-name"
                placeholder="John"
                autoComplete="off"
                className={INPUT_CLASSNAME}
                aria-invalid={!!errors.firstName}
                aria-describedby={errors.firstName ? 'user-detail-first-name-error' : undefined}
                {...register('firstName')}
              />
              {errors.firstName && (
                <p id="user-detail-first-name-error" role="alert" className="text-caption text-danger">
                  {errors.firstName.message}
                </p>
              )}
            </div>

            <div className="flex min-w-0 flex-[1_1_11rem] flex-col gap-xxs">
              <label htmlFor="user-detail-last-name" className="field-label">
                Last name
              </label>
              <input
                id="user-detail-last-name"
                placeholder="Smith"
                autoComplete="off"
                className={INPUT_CLASSNAME}
                aria-invalid={!!errors.lastName}
                aria-describedby={errors.lastName ? 'user-detail-last-name-error' : undefined}
                {...register('lastName')}
              />
              {errors.lastName && (
                <p id="user-detail-last-name-error" role="alert" className="text-caption text-danger">
                  {errors.lastName.message}
                </p>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-xxs">
            <label htmlFor="user-detail-phone" className="field-label">
              Phone
            </label>
            <Controller
              control={control}
              name="phone"
              render={({ field }) => (
                <PhoneInput
                  id="user-detail-phone"
                  value={field.value ?? ''}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  className={INPUT_CLASSNAME}
                  aria-invalid={!!errors.phone}
                  aria-describedby={errors.phone ? 'user-detail-phone-error' : undefined}
                />
              )}
            />
            {errors.phone && (
              <p id="user-detail-phone-error" role="alert" className="text-caption text-danger">
                {errors.phone.message}
              </p>
            )}
          </div>

          {formError && (
            <p role="alert" className="text-body text-danger">
              {formError}
            </p>
          )}
          {successMessage && (
            <p role="status" className="text-body text-success">
              {successMessage}
            </p>
          )}
        </CardSection>

        <CardFooter className="mt-auto">
          <div className="flex flex-col gap-sm sm:flex-row sm:flex-wrap">{actions}</div>
          <button type="submit" disabled={isSubmitting} className="btn btn-primary w-full sm:ml-auto sm:w-auto">
            {isSubmitting ? 'Saving…' : 'Save changes'}
          </button>
        </CardFooter>
      </form>
    </Card>
  );
}

function statusBadgeClassName(status: UserStatus): string {
  if (status === 'ACTIVE') return '';
  return status === 'DELETED' ? 'badge-danger' : 'badge-dark';
}

function AccountField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-xxs">
      <dt className="text-caption text-ink-muted">{label}</dt>
      <dd className="text-ink">{children}</dd>
    </div>
  );
}
