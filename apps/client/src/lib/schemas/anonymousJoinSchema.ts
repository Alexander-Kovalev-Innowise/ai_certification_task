import { z } from 'zod';

import { emailSchema, personNameSchema } from './common';
import { passwordPolicySchema } from './passwordPolicy';
import { requiredPhoneSchema } from './phone';

export const GENDERS = ['MALE', 'FEMALE', 'OTHER', 'PREFER_NOT_TO_SAY'] as const;
export type Gender = (typeof GENDERS)[number];

// Task 11.8's plan text describes dateOfBirth as "age-derived 1-18", mirroring
// CreateChildProfileDto's BR ("1-18 years", apps/server's Task 5.1). Verified
// against the ACTUAL ShareLinkRedemptionService.redeemAnonymousRegistration
// (apps/server/src/modules/share-links/share-link-redemption.service.ts):
// unlike CreateChildProfileDto, this endpoint's RedeemShareLinkDto applies no
// age-range check at all — only `@IsDateString()`. That matters because
// `isSelf: true` here can register an ADULT (the PLAYER_PARENT account
// holder training themselves), who is routinely older than 18; hard-coding
// the 1-18 bound unconditionally would incorrectly block every adult
// self-registration. This schema therefore applies the 1-18 bound only when
// `isSelf` is false (registering a child), and just requires a valid,
// not-in-the-future date otherwise — deviation flagged for the coder/QA
// record per the plan's "verify against actual code" instruction.
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

const baseFields = {
  // The account holder's own name — separate from the player's (a parent
  // registering a child is not the child).
  parentFirstName: personNameSchema('First name'),
  parentLastName: personNameSchema('Last name'),
  email: emailSchema,
  password: passwordPolicySchema,
  phone: requiredPhoneSchema,
  playerName: personNameSchema("Player's name"),
  dateOfBirth: z.string().min(1, 'Date of birth is required.'),
  gender: z.enum(GENDERS, { message: 'Select a gender.' }),
  // The DOM field is a native <select> ("Me" / "My child"), which — like
  // every other uncontrolled react-hook-form-registered element — always
  // carries a string value. Kept as the raw 'true' | 'false' string here
  // (rather than a `z.preprocess` to boolean) deliberately: `zodResolver`'s
  // TypeScript types require a schema's parsed input and output types to
  // match `useForm`'s generic exactly, and a preprocess-to-boolean schema's
  // input type (`unknown`) doesn't satisfy that — verified as a real build
  // error, not just a lint nit. The string->boolean conversion happens in
  // AnonymousJoinForm.tsx's submit handler instead, once RHF/zod are done.
  isSelf: z.enum(['true', 'false'], { message: 'Select who this registration is for.' }),
};

// api §4.4 ANONYMOUS_REGISTRATION branch — full player-registration body,
// rendered for `type: 'PLAYER_STATIC'`.
export const anonymousPlayerRegistrationSchema = z
  .object(baseFields)
  .superRefine((values, ctx) => {
    const age = parseAge(values.dateOfBirth);
    if (age === null) {
      ctx.addIssue({ code: 'custom', path: ['dateOfBirth'], message: 'Enter a valid date.' });
      return;
    }
    if (age < 0) {
      ctx.addIssue({ code: 'custom', path: ['dateOfBirth'], message: 'Date of birth cannot be in the future.' });
      return;
    }
    if (values.isSelf === 'false' && (age < 1 || age > 18)) {
      ctx.addIssue({ code: 'custom', path: ['dateOfBirth'], message: 'Age must be between 1 and 18 years.' });
    }
    // All players under 18 are parent-managed: a minor cannot register as "Me".
    if (values.isSelf === 'true' && age < 18) {
      ctx.addIssue({
        code: 'custom',
        path: ['dateOfBirth'],
        message: 'Players under 18 must be registered by a parent - choose "My child".',
      });
    }
  });

export type AnonymousPlayerRegistrationFormValues = z.infer<typeof anonymousPlayerRegistrationSchema>;

// api §4.4 COACH_ACCEPT (anonymous) branch: body is `{ firstName, lastName,
// password }` — no email field (the target email comes from the link's own
// `targetEmail` server-side). The new coach's name is collected here rather
// than derived from the email. Rendered for `type: 'COACH_UNIQUE'` with no
// access token.
export const anonymousCoachAcceptSchema = z.object({
  firstName: personNameSchema('First name'),
  lastName: personNameSchema('Last name'),
  password: passwordPolicySchema,
});

export type AnonymousCoachAcceptFormValues = z.infer<typeof anonymousCoachAcceptSchema>;
