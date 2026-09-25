'use client';

import type { ChangeEvent } from 'react';

// api §2 GET /impersonation/history — `?limit&cursor&adminUserId?&targetUserId?&dateFrom?&dateTo?`.
export interface HistoryFiltersValue {
  adminUserId: string;
  targetUserId: string;
  dateFrom: string;
  dateTo: string;
}

export interface HistoryFiltersProps {
  value: HistoryFiltersValue;
  onChange: (value: HistoryFiltersValue) => void;
}

// fe §5.1/api §2 — HistoryFilters: admin/target/date range controls for
// `/impersonation-history`'s GET /impersonation/history query. Purely
// controlled, same shape as UserFilters (Task 12.3) — the page owns filter
// state and the useInfiniteQuery refetch that follows a change. Task 16.2.
export function HistoryFilters({ value, onChange }: HistoryFiltersProps) {
  function handleAdminChange(event: ChangeEvent<HTMLInputElement>) {
    onChange({ ...value, adminUserId: event.target.value });
  }

  function handleTargetChange(event: ChangeEvent<HTMLInputElement>) {
    onChange({ ...value, targetUserId: event.target.value });
  }

  function handleDateFromChange(event: ChangeEvent<HTMLInputElement>) {
    onChange({ ...value, dateFrom: event.target.value });
  }

  function handleDateToChange(event: ChangeEvent<HTMLInputElement>) {
    onChange({ ...value, dateTo: event.target.value });
  }

  return (
    <form role="search" aria-label="Filter impersonation history" onSubmit={(event) => event.preventDefault()} className="flex flex-wrap items-end gap-md">
      <div className="flex flex-col gap-xxs">
        <label htmlFor="history-filter-admin" className="text-caption text-[var(--text-secondary)]">
          Admin User ID
        </label>
        <input
          id="history-filter-admin"
          type="text"
          value={value.adminUserId}
          onChange={handleAdminChange}
          placeholder="Admin user id"
          className="rounded-sm border border-[var(--border-soft)] bg-[var(--surface-1)] p-sm text-body text-[var(--text-primary)] outline-none focus:border-[var(--brand-primary)]"
        />
      </div>

      <div className="flex flex-col gap-xxs">
        <label htmlFor="history-filter-target" className="text-caption text-[var(--text-secondary)]">
          Target User ID
        </label>
        <input
          id="history-filter-target"
          type="text"
          value={value.targetUserId}
          onChange={handleTargetChange}
          placeholder="Target user id"
          className="rounded-sm border border-[var(--border-soft)] bg-[var(--surface-1)] p-sm text-body text-[var(--text-primary)] outline-none focus:border-[var(--brand-primary)]"
        />
      </div>

      <div className="flex flex-col gap-xxs">
        <label htmlFor="history-filter-date-from" className="text-caption text-[var(--text-secondary)]">
          From
        </label>
        <input
          id="history-filter-date-from"
          type="date"
          value={value.dateFrom}
          onChange={handleDateFromChange}
          className="rounded-sm border border-[var(--border-soft)] bg-[var(--surface-1)] p-sm text-body text-[var(--text-primary)]"
        />
      </div>

      <div className="flex flex-col gap-xxs">
        <label htmlFor="history-filter-date-to" className="text-caption text-[var(--text-secondary)]">
          To
        </label>
        <input
          id="history-filter-date-to"
          type="date"
          value={value.dateTo}
          onChange={handleDateToChange}
          className="rounded-sm border border-[var(--border-soft)] bg-[var(--surface-1)] p-sm text-body text-[var(--text-primary)]"
        />
      </div>
    </form>
  );
}
