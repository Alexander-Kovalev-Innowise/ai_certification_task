'use client';

import { useState, type ChangeEvent } from 'react';

import { historyFiltersSchema } from '../../lib/schemas/historyFiltersSchema';
import { FILTER_CARD_CLASSNAME } from '../shared/filterCard';

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

const INPUT_CLASSNAME =
  'w-full min-w-0';

// fe §5.1/api §2 — HistoryFilters: admin/target/date range controls for
// `/impersonation-history`'s GET /impersonation/history query. Purely
// controlled, same shape as UserFilters (Task 12.3) — the page owns filter
// state and the useInfiniteQuery refetch that follows a change. Task 16.2.
//
// Validation is schema-driven (`historyFiltersSchema`) but non-blocking: this
// component is controlled by the page's query state, so it keeps reporting
// every change upward and only surfaces inline errors (user ids must be UUIDs,
// the range must not be inverted) once a field has been touched.
export function HistoryFilters({ value, onChange }: HistoryFiltersProps) {
  const [touched, setTouched] = useState<Partial<Record<keyof HistoryFiltersValue, boolean>>>({});

  const parsed = historyFiltersSchema.safeParse(value);
  const fieldErrors: Partial<Record<keyof HistoryFiltersValue, string>> = {};
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const key = issue.path[0] as keyof HistoryFiltersValue | undefined;
      if (key && !fieldErrors[key]) {
        fieldErrors[key] = issue.message;
      }
    }
  }

  function markTouched(field: keyof HistoryFiltersValue) {
    setTouched((prev) => (prev[field] ? prev : { ...prev, [field]: true }));
  }

  function errorFor(field: keyof HistoryFiltersValue): string | undefined {
    return touched[field] ? fieldErrors[field] : undefined;
  }

  const adminError = errorFor('adminUserId');
  const targetError = errorFor('targetUserId');
  const dateToError = errorFor('dateTo');

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
    <form role="search" aria-label="Filter impersonation history" onSubmit={(event) => event.preventDefault()} className={`flex flex-wrap items-start gap-md ${FILTER_CARD_CLASSNAME}`}>
      <div className="flex min-w-0 flex-[1_1_14rem] flex-col gap-xxs">
        <label htmlFor="history-filter-admin" className="field-label">
          Admin User ID
        </label>
        <input
          id="history-filter-admin"
          type="text"
          value={value.adminUserId}
          onChange={handleAdminChange}
          onBlur={() => markTouched('adminUserId')}
          placeholder="e.g. 3f2b8c1e-5a4d-4b6f-9c7e-1d2a3b4c5d6e"
          autoComplete="off"
          spellCheck={false}
          aria-invalid={!!adminError}
          aria-describedby={adminError ? 'history-filter-admin-error' : undefined}
          className={INPUT_CLASSNAME}
        />
        {adminError && (
          <p id="history-filter-admin-error" role="alert" className="text-caption text-danger">
            {adminError}
          </p>
        )}
      </div>

      <div className="flex min-w-0 flex-[1_1_14rem] flex-col gap-xxs">
        <label htmlFor="history-filter-target" className="field-label">
          Target User ID
        </label>
        <input
          id="history-filter-target"
          type="text"
          value={value.targetUserId}
          onChange={handleTargetChange}
          onBlur={() => markTouched('targetUserId')}
          placeholder="e.g. 9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d"
          autoComplete="off"
          spellCheck={false}
          aria-invalid={!!targetError}
          aria-describedby={targetError ? 'history-filter-target-error' : undefined}
          className={INPUT_CLASSNAME}
        />
        {targetError && (
          <p id="history-filter-target-error" role="alert" className="text-caption text-danger">
            {targetError}
          </p>
        )}
      </div>

      <div className="flex min-w-0 flex-[1_1_9rem] flex-col gap-xxs">
        <label htmlFor="history-filter-date-from" className="field-label">
          From
        </label>
        <input
          id="history-filter-date-from"
          type="date"
          value={value.dateFrom}
          max={value.dateTo || undefined}
          onChange={handleDateFromChange}
          onBlur={() => markTouched('dateFrom')}
          autoComplete="off"
          className={INPUT_CLASSNAME}
        />
      </div>

      <div className="flex min-w-0 flex-[1_1_9rem] flex-col gap-xxs">
        <label htmlFor="history-filter-date-to" className="field-label">
          To
        </label>
        <input
          id="history-filter-date-to"
          type="date"
          value={value.dateTo}
          min={value.dateFrom || undefined}
          onChange={handleDateToChange}
          onBlur={() => markTouched('dateTo')}
          autoComplete="off"
          aria-invalid={!!dateToError}
          aria-describedby={dateToError ? 'history-filter-date-to-error' : undefined}
          className={INPUT_CLASSNAME}
        />
        {dateToError && (
          <p id="history-filter-date-to-error" role="alert" className="text-caption text-danger">
            {dateToError}
          </p>
        )}
      </div>
    </form>
  );
}
