import { z } from 'zod';

import { GENDERS } from './anonymousJoinSchema';
import { emailSchema, personNameSchema } from './common';
import { requiredPhoneSchema } from './phone';

export const CAMP_SOURCES = ['CAMP', 'EVALUATION'] as const;
export type CampSource = (typeof CAMP_SOURCES)[number];

// Stand-in for the Epic-08 camp/evaluation form. Mirrors the server's CreateCampConversionDto.
// `playerAge` stays a string here: it is a text input (like AnonymousJoinForm's `isSelf` select), and
// zodResolver's types need a parse-input === output schema; the number conversion happens on submit.
export const campSignupSchema = z.object({
  parentFirstName: personNameSchema('First name'),
  parentLastName: personNameSchema('Last name'),
  email: emailSchema,
  phone: requiredPhoneSchema,
  playerName: personNameSchema("Player's name"),
  playerAge: z
    .string()
    .trim()
    .min(1, 'Age is required.')
    .refine((value) => /^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= 99, 'Enter an age between 1 and 99.'),
  playerGender: z.enum(GENDERS, { message: 'Select a gender.' }),
  source: z.enum(CAMP_SOURCES),
});

export type CampSignupFormValues = z.infer<typeof campSignupSchema>;
