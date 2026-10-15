import { z } from 'zod';

import { personNameSchema } from './common';

// POST /player-profiles with `isSelf: true` — "Add myself as a player". The
// 1-18 child age rule does not apply; only a valid, past date of birth.
export const SELF_GENDERS = ['MALE', 'FEMALE', 'OTHER', 'PREFER_NOT_TO_SAY'] as const;

export const addSelfProfileSchema = z
  .object({
    name: personNameSchema('Name'),
    dateOfBirth: z.string().min(1, 'Date of birth is required.'),
    gender: z.enum(SELF_GENDERS, { message: 'Select a gender.' }),
  })
  .superRefine((values, ctx) => {
    const dob = new Date(values.dateOfBirth);
    if (Number.isNaN(dob.getTime())) {
      ctx.addIssue({ code: 'custom', path: ['dateOfBirth'], message: 'Enter a valid date.' });
      return;
    }
    if (dob.getTime() > Date.now()) {
      ctx.addIssue({ code: 'custom', path: ['dateOfBirth'], message: 'Date of birth cannot be in the future.' });
      return;
    }
    // A guardian's own player profile is for an adult; anyone under 18 is added as a child profile.
    const adultCutoff = new Date();
    adultCutoff.setFullYear(adultCutoff.getFullYear() - 18);
    if (dob.getTime() > adultCutoff.getTime()) {
      ctx.addIssue({ code: 'custom', path: ['dateOfBirth'], message: 'Players under 18 are added as a child profile instead.' });
    }
  });

export type AddSelfProfileFormValues = z.infer<typeof addSelfProfileSchema>;
