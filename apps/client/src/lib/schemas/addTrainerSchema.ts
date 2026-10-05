import { z } from 'zod';

// api §4.3 `AddTrainerAssociationDto` — oneOf `{shareLinkCode} | {trainerId}`.
// The server generates share-link codes as 12 random bytes base64url-encoded
// (16 chars of [A-Za-z0-9_-]) but treats the field as an opaque string, so the
// client only checks the URL-safe alphabet and a sane length — never an exact
// length that a future code format change would break.
export const ADD_TRAINER_MODES = ['code', 'pick'] as const;

const SHARE_LINK_CODE_PATTERN = /^[A-Za-z0-9_-]+$/;

export const addTrainerSchema = z
  .object({
    mode: z.enum(ADD_TRAINER_MODES),
    shareLinkCode: z.string().trim(),
    trainerId: z.string(),
  })
  .superRefine((values, ctx) => {
    if (values.mode === 'code') {
      if (!values.shareLinkCode) {
        ctx.addIssue({ code: 'custom', path: ['shareLinkCode'], message: 'Share link code is required.' });
      } else if (values.shareLinkCode.length > 64) {
        ctx.addIssue({ code: 'custom', path: ['shareLinkCode'], message: 'Share link code must be 64 characters or fewer.' });
      } else if (!SHARE_LINK_CODE_PATTERN.test(values.shareLinkCode)) {
        ctx.addIssue({
          code: 'custom',
          path: ['shareLinkCode'],
          message: 'Share link codes only contain letters, numbers, hyphens and underscores. Paste just the code, not the whole link.',
        });
      }
      return;
    }
    if (!values.trainerId) {
      ctx.addIssue({ code: 'custom', path: ['trainerId'], message: 'Select a trainer.' });
    }
  });

export type AddTrainerFormValues = z.infer<typeof addTrainerSchema>;
