import { z } from 'zod';

// api §4.4 `CreateShareLinkDto`, reproduced: `type` enum
// `PLAYER_STATIC | COACH_UNIQUE`; `targetEmail` conditionally required via
// `.superRefine`, mirroring the server DTO's
// `@ValidateIf(o => o.type === 'COACH_UNIQUE') @IsEmail() targetEmail?`.
// Task 13.3.
export const SHARE_LINK_TYPES = ['PLAYER_STATIC', 'COACH_UNIQUE'] as const;
export type ShareLinkType = (typeof SHARE_LINK_TYPES)[number];

export const createShareLinkSchema = z
  .object({
    type: z.enum(SHARE_LINK_TYPES, { message: 'Select a link type.' }),
    targetEmail: z.string().max(255).email('Enter a valid email address.').optional().or(z.literal('')),
  })
  .superRefine((values, ctx) => {
    if (values.type === 'COACH_UNIQUE' && !values.targetEmail) {
      ctx.addIssue({ code: 'custom', path: ['targetEmail'], message: 'Email is required for a coach invite link.' });
    }
  });

export type CreateShareLinkFormValues = z.infer<typeof createShareLinkSchema>;
