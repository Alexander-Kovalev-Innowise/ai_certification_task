'use client';

import { useState } from 'react';

import { formatAvailabilitySummary, type AvailabilitySlot } from '../../lib/formatting/availability-summary.formatter';

export type AvailabilityGridSlot = AvailabilitySlot;

export interface AvailabilityGridProps {
  subject: 'player' | 'coach';
  mode: 'view' | 'edit';
  slots: AvailabilityGridSlot[];
  /** Edit mode only — called with the full replace-ready slot array once client-side validation passes. */
  onSave?: (slots: AvailabilityGridSlot[]) => void;
  isSaving?: boolean;
}

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/** Edit boundary only (fe §5.4) — minutes-from-midnight -> a native `<input type="time">`'s `HH:mm` value. No timezone math anywhere in this file (OQ-5). */
function minutesToHHMM(minutesFromMidnight: number): string {
  const hours = Math.floor(minutesFromMidnight / 60);
  const minutes = minutesFromMidnight % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/** Inverse of `minutesToHHMM` — the only other place a wire number and a picker string ever convert. */
function hhmmToMinutes(value: string): number {
  const [hours, minutes] = value.split(':').map((part) => Number.parseInt(part, 10));
  return (hours || 0) * 60 + (minutes || 0);
}

const ROW_BUTTON_CLASSNAME = 'rounded-sm border border-[var(--border-soft)] p-xxs text-caption text-[var(--text-primary)] hover:border-[var(--brand-primary)]';

/**
 * fe §5.4 — one component, two subjects (`player`/`coach`) and two modes
 * (`view`/`edit`), reused by `/my-times` (Task 15.3) and
 * `/profiles/[id]/availability` (Task 14.7). `subject` currently only
 * affects the component's `aria-label`/heading copy — both subjects share
 * the identical `AvailabilitySlotResponseDto` wire shape (api §4.5), so
 * there's no behavioral branch on it yet.
 *
 * Edit mode owns its own draft state and "Save" action rather than being a
 * fully controlled input — the two consumers (Tasks 14.7/15.3) both just
 * need "fetch slots, render the grid, PUT the edited slots," so bundling
 * the save trigger here keeps both call sites to a fetch + `onSave` callback
 * instead of re-implementing add/remove/validate state. Callers seed a fresh
 * `slots` prop after a refetch by remounting via a `key` prop (same
 * established pattern as `ChildProfileForm`/`InviteCoachModal`'s prefill-on-open),
 * not by syncing props into state in an effect.
 */
export function AvailabilityGrid({ subject, mode, slots, onSave, isSaving = false }: AvailabilityGridProps) {
  const [draft, setDraft] = useState<AvailabilityGridSlot[]>(() => slots.filter((slot) => slot.isAvailable));
  const [rangeErrors, setRangeErrors] = useState<Record<number, string>>({});

  if (mode === 'view') {
    return (
      <div className="flex flex-col gap-sm">
        <div role="grid" aria-label={`${subject === 'coach' ? "Coach's" : "Player's"} availability`} className="flex flex-col gap-xxs">
          {DAY_LABELS.map((day, dayIndex) => {
            const daySlots = slots.filter((slot) => slot.dayOfWeek === dayIndex && slot.isAvailable);
            return (
              <div key={day} role="row" aria-label={day} className="flex items-center gap-sm text-body text-[var(--text-primary)]">
                <span className="w-10 font-semibold">{day}</span>
                {daySlots.length === 0 ? (
                  <span className="text-[var(--text-secondary)]">—</span>
                ) : (
                  <span className="font-numeric text-[var(--text-secondary)]">
                    {daySlots.map((slot) => `${minutesToHHMM(slot.startTime)}-${minutesToHHMM(slot.endTime)}`).join(', ')}
                  </span>
                )}
              </div>
            );
          })}
        </div>
        <p data-testid="availability-summary" className="text-caption text-[var(--text-secondary)]">
          Best Times: {formatAvailabilitySummary(slots) || 'None set'}
        </p>
      </div>
    );
  }

  function addRow(dayOfWeek: number) {
    setDraft((prev) => [...prev, { dayOfWeek, startTime: 9 * 60, endTime: 10 * 60, isAvailable: true }]);
  }

  function removeRow(index: number) {
    setDraft((prev) => prev.filter((_, i) => i !== index));
    setRangeErrors((prev) => {
      const { [index]: _removed, ...rest } = prev;
      return rest;
    });
  }

  function updateRow(index: number, patch: Partial<AvailabilityGridSlot>) {
    setDraft((prev) => prev.map((slot, i) => (i === index ? { ...slot, ...patch } : slot)));
  }

  function handleSave() {
    const errors: Record<number, string> = {};
    draft.forEach((slot, index) => {
      if (slot.startTime >= slot.endTime) {
        errors[index] = 'Start time must be before end time.';
      }
    });
    setRangeErrors(errors);
    if (Object.keys(errors).length > 0) {
      return;
    }
    onSave?.(draft);
  }

  return (
    <div className="flex flex-col gap-md">
      {DAY_LABELS.map((day, dayIndex) => (
        <div key={day} className="flex flex-col gap-xxs rounded-md border border-[var(--border-soft)] p-sm">
          <div className="flex items-center justify-between">
            <span className="text-body font-semibold text-[var(--text-primary)]">{day}</span>
            <button type="button" onClick={() => addRow(dayIndex)} className={ROW_BUTTON_CLASSNAME}>
              + Add time
            </button>
          </div>

          {draft.map(
            (slot, index) =>
              slot.dayOfWeek === dayIndex && (
                <div key={index} className="flex items-center gap-sm">
                  <input
                    aria-label={`${day} start`}
                    type="time"
                    value={minutesToHHMM(slot.startTime)}
                    onChange={(event) => updateRow(index, { startTime: hhmmToMinutes(event.target.value) })}
                    className="rounded-sm border border-[var(--border-soft)] bg-[var(--surface-0)] p-xxs text-body text-[var(--text-primary)]"
                  />
                  <span className="text-caption text-[var(--text-secondary)]">to</span>
                  <input
                    aria-label={`${day} end`}
                    type="time"
                    value={minutesToHHMM(slot.endTime)}
                    onChange={(event) => updateRow(index, { endTime: hhmmToMinutes(event.target.value) })}
                    className="rounded-sm border border-[var(--border-soft)] bg-[var(--surface-0)] p-xxs text-body text-[var(--text-primary)]"
                  />
                  <button type="button" onClick={() => removeRow(index)} className={ROW_BUTTON_CLASSNAME}>
                    Remove
                  </button>
                  {rangeErrors[index] && (
                    <p role="alert" className="text-caption text-[var(--danger)]">
                      {rangeErrors[index]}
                    </p>
                  )}
                </div>
              ),
          )}
        </div>
      ))}

      <div className="flex justify-end">
        <button
          type="button"
          onClick={handleSave}
          disabled={isSaving}
          className="rounded-sm bg-[var(--brand-primary)] p-sm text-body font-semibold text-[#0D0D0D] shadow-button-primary disabled:opacity-60"
        >
          {isSaving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}
