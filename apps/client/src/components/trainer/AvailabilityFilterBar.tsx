'use client';

// api §4.3 GET /trainers/:id/players — `?dayOfWeek?&startTime?&endTime?`
// (ListRosterQueryDto). `dayOfWeek` follows `Date.getDay()`'s convention
// (0 = Sunday ... 6 = Saturday), same as AvailabilityGrid/the formatter.
export interface AvailabilityFilter {
  dayOfWeek?: number;
  startTime?: number;
  endTime?: number;
}

export interface AvailabilityFilterBarProps {
  value: AvailabilityFilter;
  onChange: (filter: AvailabilityFilter) => void;
}

const DAY_OPTIONS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

function minutesToHHMM(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

function hhmmToMinutes(value: string): number {
  const [hours, minutes] = value.split(':').map((part) => Number.parseInt(part, 10));
  return (hours || 0) * 60 + (minutes || 0);
}

const INPUT_CLASSNAME =
  'rounded-sm border border-[var(--border-soft)] bg-[var(--surface-0)] p-xxs text-body text-[var(--text-primary)] outline-none focus:border-[var(--brand-primary)]';

// fe §4.4 — AvailabilityFilterBar: `/players`' day/time filter, narrows the
// roster to players with a saved available slot on that day (optionally
// overlapping the given time range) — same minutes-from-midnight/HH:mm
// edit-boundary conversion as `AvailabilityGrid` (Task 14.6), no timezone
// conversion anywhere (OQ-5). Task 14.9.
export function AvailabilityFilterBar({ value, onChange }: AvailabilityFilterBarProps) {
  return (
    <div className="flex flex-wrap items-end gap-md">
      <div className="flex flex-col gap-xxs">
        <label htmlFor="availability-filter-day" className="text-caption text-[var(--text-secondary)]">
          Day
        </label>
        <select
          id="availability-filter-day"
          className={INPUT_CLASSNAME}
          value={value.dayOfWeek ?? ''}
          onChange={(event) => onChange({ ...value, dayOfWeek: event.target.value === '' ? undefined : Number(event.target.value) })}
        >
          <option value="">Any day</option>
          {DAY_OPTIONS.map((day, index) => (
            <option key={day} value={index}>
              {day}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-xxs">
        <label htmlFor="availability-filter-from" className="text-caption text-[var(--text-secondary)]">
          From
        </label>
        <input
          id="availability-filter-from"
          type="time"
          className={INPUT_CLASSNAME}
          value={value.startTime !== undefined ? minutesToHHMM(value.startTime) : ''}
          onChange={(event) => onChange({ ...value, startTime: event.target.value ? hhmmToMinutes(event.target.value) : undefined })}
        />
      </div>

      <div className="flex flex-col gap-xxs">
        <label htmlFor="availability-filter-to" className="text-caption text-[var(--text-secondary)]">
          To
        </label>
        <input
          id="availability-filter-to"
          type="time"
          className={INPUT_CLASSNAME}
          value={value.endTime !== undefined ? minutesToHHMM(value.endTime) : ''}
          onChange={(event) => onChange({ ...value, endTime: event.target.value ? hhmmToMinutes(event.target.value) : undefined })}
        />
      </div>

      <button type="button" onClick={() => onChange({})} className="rounded-sm p-xxs text-caption text-[var(--text-secondary)]">
        Clear
      </button>
    </div>
  );
}
