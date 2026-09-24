import { z } from 'zod';

// api §4.3 `CreateChildProfileDto`, reproduced: `name` max100,
// `dateOfBirth` ISO date string (server derives age, validated 1-18 — BR
// "1-18 years"), `gender` enum, `school` max200 optional, `photoUrl` optional
// URL, `trainerIds` optional UUID array (FR-031's selection checklist).
// Duplicate-name/age is explicitly non-blocking (api §4.3: returns `200
// {warning}` instead of a hard `409`) — deliberately NOT a zod rule here,
// per Task 14.3's own note; `ChildProfileForm` surfaces that warning from
// the response after a successful submit instead. Task 14.3.
export const GENDERS = ['MALE', 'FEMALE', 'OTHER', 'PREFER_NOT_TO_SAY'] as const;
export type Gender = (typeof GENDERS)[number];

// Same age-derivation as anonymousJoinSchema.ts's `parseAge` (Task 11.8) —
// duplicated rather than imported since the two schemas live in independent
// files with no shared "age math" module yet (same documented-duplication
// tradeoff as AvailabilityGrid's formatter, fe §5.4/§11.7).
function parseAge(dateOfBirth: string): number | null {
  const dob = new Date(dateOfBirth);
  if (Number.isNaN(dob.getTime())) {
    return null;
  }
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const monthDiff = now.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < dob.getDate())) {
    age -= 1;
  }
  return age;
}

export const createChildProfileSchema = z
  .object({
    name: z.string().min(1, "Name is required.").max(100),
    dateOfBirth: z.string().min(1, 'Date of birth is required.'),
    gender: z.enum(GENDERS, { message: 'Select a gender.' }),
    school: z.string().max(200).optional().or(z.literal('')),
    photoUrl: z.string().url('Enter a valid URL.').optional().or(z.literal('')),
    trainerIds: z.array(z.string()).optional(),
  })
  .superRefine((values, ctx) => {
    const age = parseAge(values.dateOfBirth);
    if (age === null) {
      ctx.addIssue({ code: 'custom', path: ['dateOfBirth'], message: 'Enter a valid date.' });
      return;
    }
    if (age < 1 || age > 18) {
      ctx.addIssue({ code: 'custom', path: ['dateOfBirth'], message: 'Age must be between 1 and 18 years.' });
    }
  });

export type CreateChildProfileFormValues = z.infer<typeof createChildProfileSchema>;
