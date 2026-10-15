// Task 5.10 (api §4.3 "GET /trainers/:id/players", FR-070's minimal roster).
// Produces the `"Mon 5-8pm, Wed 6-9pm"` compact format from a slot array —
// kept pure and standalone (no Nest DI, no Prisma types) so the frontend
// engineer building fe §5.4/§11.7's client-side port (Task 14.6) can read
// this file directly as the reference implementation without pulling in
// backend dependencies, per the plan's own note on this task.
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

const SUMMARY_PREFIX = 'Best Times:';

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
 * US-01.09: `"Best Times: Mon 5-8pm, Wed 6-9pm"` — the `Best Times:` prefix
 * followed by one comma-joined `"<Day> <range>"` entry per available slot, ordered by
 * day then start time. Only `isAvailable: true` slots are included — an
 * explicit "not available" row carries no summary value for a trainer
 * scanning for open players. No available slots yields `''` (callers show
 * their own "No availability set" placeholder).
 */
export function formatAvailabilitySummary(slots: readonly AvailabilitySlot[]): string {
  const entries = slots
    .filter((slot) => slot.isAvailable)
    .slice()
    .sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.startTime - b.startTime)
    .map((slot) => `${DAY_LABELS[slot.dayOfWeek]} ${formatRange(slot.startTime, slot.endTime)}`);
  return entries.length === 0 ? '' : `${SUMMARY_PREFIX} ${entries.join(', ')}`;
}

export interface PlayerAvailabilitySlot extends AvailabilitySlot {
  playerProfileId: string;
}

export interface SuggestedWindow {
  dayOfWeek: number;
  startTime: number;
  endTime: number;
  /** Distinct players available for the whole window. */
  availableCount: number;
}

export const SUGGESTED_TIMES_LIMIT = 3;

/**
 * Spec US-01.09 "Suggest session times matching most players' availability".
 * Per day, sweeps the players' available slots into windows in which one
 * fixed set of players is available throughout (adjacent stretches with the
 * same set are merged), then ranks the windows: most players first, then the
 * longer window, then earliest day/start. Pure and deterministic - the same
 * slots always give the same top `limit` windows.
 */
export function computeSuggestedWindows(
  slots: readonly PlayerAvailabilitySlot[],
  limit: number = SUGGESTED_TIMES_LIMIT,
): SuggestedWindow[] {
  const windows: Array<SuggestedWindow & { key: string }> = [];

  for (let dayOfWeek = 0; dayOfWeek < DAY_LABELS.length; dayOfWeek += 1) {
    const events: Array<{ time: number; playerProfileId: string; delta: 1 | -1 }> = [];
    for (const slot of slots) {
      if (slot.isAvailable && slot.dayOfWeek === dayOfWeek && slot.startTime < slot.endTime) {
        events.push({ time: slot.startTime, playerProfileId: slot.playerProfileId, delta: 1 });
        events.push({ time: slot.endTime, playerProfileId: slot.playerProfileId, delta: -1 });
      }
    }
    events.sort((a, b) => a.time - b.time);

    const open = new Map<string, number>();
    let previous: (SuggestedWindow & { key: string }) | undefined;
    for (let index = 0; index < events.length; index += 1) {
      const event = events[index]!;
      open.set(event.playerProfileId, (open.get(event.playerProfileId) ?? 0) + event.delta);
      const next = events[index + 1];
      if (next && next.time === event.time) {
        continue;
      }
      if (!next) {
        break;
      }

      const ids = [...open.entries()].filter(([, depth]) => depth > 0).map(([id]) => id).sort();
      if (ids.length === 0) {
        previous = undefined;
        continue;
      }
      const key = ids.join(',');
      if (previous && previous.endTime === event.time && previous.key === key) {
        previous.endTime = next.time;
      } else {
        previous = { dayOfWeek, startTime: event.time, endTime: next.time, availableCount: ids.length, key };
        windows.push(previous);
      }
    }
  }

  return windows
    .sort(
      (a, b) =>
        b.availableCount - a.availableCount ||
        b.endTime - b.startTime - (a.endTime - a.startTime) ||
        a.dayOfWeek - b.dayOfWeek ||
        a.startTime - b.startTime,
    )
    .slice(0, limit)
    .map(({ dayOfWeek, startTime, endTime, availableCount }) => ({ dayOfWeek, startTime, endTime, availableCount }));
}

function clockLabel(minutesFromMidnight: number): string {
  const totalMinutes = ((minutesFromMidnight % 1440) + 1440) % 1440;
  const hour = Math.floor(totalMinutes / 60) % 12 || 12;
  return `${hour}:${String(totalMinutes % 60).padStart(2, '0')}`;
}

/** `"Mon 5:00-8:00 PM"`, or `"Mon 11:00 AM-1:00 PM"` when the window crosses noon. */
export function formatSuggestedRange(dayOfWeek: number, startTime: number, endTime: number): string {
  const startPeriod = period(startTime).toUpperCase();
  const endPeriod = period(endTime).toUpperCase();
  const start = startPeriod === endPeriod ? clockLabel(startTime) : `${clockLabel(startTime)} ${startPeriod}`;
  return `${DAY_LABELS[dayOfWeek]} ${start}-${clockLabel(endTime)} ${endPeriod}`;
}
