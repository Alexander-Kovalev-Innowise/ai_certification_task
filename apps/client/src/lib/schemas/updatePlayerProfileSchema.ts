import { z } from 'zod';

import { personNameSchema } from './common';
import { optionalHttpUrlSchema, optionalPersonNameSchema, optionalTextSchema } from './optionalFields';
import { optionalPhoneSchema } from './phone';

// api §4.3 `UpdatePlayerProfileDto`: name max100, school max200,
// jerseyNumber max20, photoUrl URL, emergencyContact free-form object (the UI
// sends `{ name, phone }`). Emergency contact name/phone are both-or-neither:
// a phone with no name (or vice versa) is not a usable contact.
const JERSEY_NUMBER_PATTERN = /^[A-Za-z0-9-]*$/;

export const updatePlayerProfileSchema = z
  .object({
    name: personNameSchema('Name'),
    school: optionalTextSchema('School', 200),
    jerseyNumber: optionalTextSchema('Jersey number', 20).regex(JERSEY_NUMBER_PATTERN, 'Jersey number can only contain letters, numbers and hyphens.'),
    photoUrl: optionalHttpUrlSchema('Photo URL'),
    emergencyContactName: optionalPersonNameSchema('Contact name'),
    emergencyContactPhone: optionalPhoneSchema,
    allowChildTokenSpendWithoutApproval: z.boolean(),
  })
  .superRefine((values, ctx) => {
    const hasName = values.emergencyContactName.trim() !== '';
    const hasPhone = !!values.emergencyContactPhone;
    if (hasPhone && !hasName) {
      ctx.addIssue({ code: 'custom', path: ['emergencyContactName'], message: 'Enter a contact name, or clear the phone number.' });
    }
    if (hasName && !hasPhone) {
      ctx.addIssue({ code: 'custom', path: ['emergencyContactPhone'], message: 'Enter a contact phone number, or clear the name.' });
    }
  });

export type UpdatePlayerProfileFormValues = z.infer<typeof updatePlayerProfileSchema>;
