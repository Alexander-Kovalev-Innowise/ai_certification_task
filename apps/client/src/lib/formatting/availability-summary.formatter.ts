// Task 14.6 (fe §5.4/§11.7) — client-side port of
// apps/server/src/modules/associations/availability-summary.formatter.ts
// (Task 5.10). MUST produce identical output to the server's
// `RosterRowDto.availabilitySummary` formatter — the trainer roster list
// precomputes this same string server-side (`GET /trainers/:id/players`),
// while a player's own `AvailabilityGrid` view mode computes it client-side
// from the same slot shape; fe §11.7 flags this duplication explicitly as a
// drift risk, so this file is a line-for-line port, not a reinterpretation.
// No shared `packages/` workspace exists yet for `apps/client`/`apps/server`
// to both import a single implementation from (fe §11.7's own open question).
//
// `dayOfWeek` follows `Date.getDay()`'s convention (0 = Sunday ... 6 =
// Saturday) — the same "0-6" the Availability model/api spec use without
// further disambiguation; this formatter is the one place that convention
// is made concrete.
export interface AvailabilitySlot {
  dayOfWeek: number;
  startTime: number; // minutes from midnight, 0-1440
  endTime: number;
  isAvailable: boolean;
}

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

function hourLabel(minutesFromMidnight: number): string {
  const totalMinutes = ((minutesFromMidnight % 1440) + 1440) % 1440;
  let hour = Math.floor(totalMinutes / 60) % 12;
  if (hour === 0) {
    hour = 12;
  }
  const minutes = totalMinutes % 60;
  return minutes === 0 ? `${hour}` : `${hour}:${String(minutes).padStart(2, '0')}`;
}

function period(minutesFromMidnight: number): 'am' | 'pm' {
  const totalMinutes = ((minutesFromMidnight % 1440) + 1440) % 1440;
  return Math.floor(totalMinutes / 60) >= 12 ? 'pm' : 'am';
}

/** `"5-8pm"` when start/end share an am/pm period, `"5am-8pm"` otherwise — the compact convention the format example uses. */
function formatRange(startTime: number, endTime: number): string {
  const startLabel = hourLabel(startTime);
  const endLabel = `${hourLabel(endTime)}${period(endTime)}`;
  return period(startTime) === period(endTime) ? `${startLabel}-${endLabel}` : `${startLabel}${period(startTime)}-${endLabel}`;
}

/**
 * One comma-joined `"<Day> <range>"` entry per available slot, ordered by
 * day then start time. Only `isAvailable: true` slots are included — an
 * explicit "not available" row carries no summary value for a trainer
 * scanning for open players.
 */
export function formatAvailabilitySummary(slots: readonly AvailabilitySlot[]): string {
  return slots
    .filter((slot) => slot.isAvailable)
    .slice()
    .sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.startTime - b.startTime)
    .map((slot) => `${DAY_LABELS[slot.dayOfWeek]} ${formatRange(slot.startTime, slot.endTime)}`)
    .join(', ');
}
