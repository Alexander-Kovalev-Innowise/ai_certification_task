import { z } from 'zod';

// api §3 `GdprDeleteUserDto` — `reason` required, non-empty, max 1000 (it goes
// into the legal-retention `UserDeletionLog`). The client additionally asks for
// a short but meaningful reason and the literal typed confirmation word.
export const GDPR_CONFIRM_WORD = 'DELETE';
export const GDPR_REASON_MIN = 10;
export const GDPR_REASON_MAX = 1000;

export const gdprDeleteSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(1, 'A reason is required for the retention record.')
    .min(GDPR_REASON_MIN, `Please give a bit more detail (at least ${GDPR_REASON_MIN} characters).`)
    .max(GDPR_REASON_MAX, `Reason must be ${GDPR_REASON_MAX} characters or fewer.`),
  confirmText: z.string().refine((value): boolean => value === GDPR_CONFIRM_WORD, `Type ${GDPR_CONFIRM_WORD} in capital letters to confirm.`),
});

export type GdprDeleteFormValues = z.infer<typeof gdprDeleteSchema>;
