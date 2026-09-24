'use client';

import type { ChangeEvent } from 'react';

import type { Role } from '../../types/auth';

import type { UserStatus } from './UsersTable';

export interface UserFiltersValue {
  search: string;
  role: Role | '';
  status: UserStatus | '';
}

export interface UserFiltersProps {
  value: UserFiltersValue;
  onChange: (value: UserFiltersValue) => void;
}

const ROLE_OPTIONS: Role[] = ['SUPER_ADMIN', 'TRAINER', 'COACH', 'PLAYER_PARENT'];
const STATUS_OPTIONS: UserStatus[] = ['ACTIVE', 'INACTIVE', 'DELETED'];

// fe §4.3 — UserFilters: search/role/status controls for GET /users'
// `?search&role&status` query (api §3). Purely controlled — the `/users`
// page owns the actual filter state and the useInfiniteQuery refetch that
// follows a change. Task 12.3.
export function UserFilters({ value, onChange }: UserFiltersProps) {
  function handleSearchChange(event: ChangeEvent<HTMLInputElement>) {
    onChange({ ...value, search: event.target.value });
  }

  function handleRoleChange(event: ChangeEvent<HTMLSelectElement>) {
    onChange({ ...value, role: event.target.value as Role | '' });
  }

  function handleStatusChange(event: ChangeEvent<HTMLSelectElement>) {
    onChange({ ...value, status: event.target.value as UserStatus | '' });
  }

  return (
    <form role="search" aria-label="Filter users" onSubmit={(event) => event.preventDefault()} className="flex flex-wrap items-end gap-md">
      <div className="flex flex-col gap-xxs">
        <label htmlFor="user-filter-search" className="text-caption text-[var(--text-secondary)]">
          Search
        </label>
        <input
          id="user-filter-search"
          type="search"
          value={value.search}
          onChange={handleSearchChange}
          placeholder="Search by name or email"
          className="rounded-sm border border-[var(--border-soft)] bg-[var(--surface-1)] p-sm text-body text-[var(--text-primary)] outline-none focus:border-[var(--brand-primary)]"
        />
      </div>

      <div className="flex flex-col gap-xxs">
        <label htmlFor="user-filter-role" className="text-caption text-[var(--text-secondary)]">
          Role
        </label>
        <select
          id="user-filter-role"
          value={value.role}
          onChange={handleRoleChange}
          className="rounded-sm border border-[var(--border-soft)] bg-[var(--surface-1)] p-sm text-body text-[var(--text-primary)]"
        >
          <option value="">All roles</option>
          {ROLE_OPTIONS.map((role) => (
            <option key={role} value={role}>
              {role}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-xxs">
        <label htmlFor="user-filter-status" className="text-caption text-[var(--text-secondary)]">
          Status
        </label>
        <select
          id="user-filter-status"
          value={value.status}
          onChange={handleStatusChange}
          className="rounded-sm border border-[var(--border-soft)] bg-[var(--surface-1)] p-sm text-body text-[var(--text-primary)]"
        >
          <option value="">All statuses</option>
          {STATUS_OPTIONS.map((status) => (
            <option key={status} value={status}>
              {status}
            </option>
          ))}
        </select>
      </div>
    </form>
  );
}
