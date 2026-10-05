import { z } from 'zod';

// US-01.10 — the trainer's "Check availability / Assign to session" form.
// Events do not exist until Epic-02, so the session is just a date, a time
// window and a free-text label (the label is optional).
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export function hhmmToMinutes(value: string): number {
  const [hours, minutes] = value.split(':').map((part) => Number.parseInt(part, 10));
  return (hours || 0) * 60 + (minutes || 0);
}

export const assignCoachSessionSchema = z
  .object({
    sessionLabel: z.string().trim().max(150, 'Session label must be 150 characters or fewer.'),
    sessionDate: z.string().min(1, 'Choose the session date.'),
    startTime: z.string().regex(TIME_PATTERN, 'Choose a start time.'),
    endTime: z.string().regex(TIME_PATTERN, 'Choose an end time.'),
  })
  .refine((values) => !TIME_PATTERN.test(values.startTime) || !TIME_PATTERN.test(values.endTime) || hhmmToMinutes(values.endTime) > hhmmToMinutes(values.startTime), {
    message: 'End time must be after the start time.',
    path: ['endTime'],
  });

export type AssignCoachSessionFormValues = z.infer<typeof assignCoachSessionSchema>;

// api §4.5 `CreateOverrideDto.reason` — required, max 500. The minimum keeps
// "ok"/"." out of the audit log.
export const overrideReasonSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(5, 'Please give a reason (at least 5 characters).')
    .max(500, 'Reason must be 500 characters or fewer.'),
});

export type OverrideReasonFormValues = z.infer<typeof overrideReasonSchema>;
