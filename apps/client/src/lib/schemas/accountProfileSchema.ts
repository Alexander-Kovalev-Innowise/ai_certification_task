import { z } from 'zod';

import { personNameSchema } from './common';
import { optionalPhoneSchema } from './phone';
import { INVALID_PHOTO_URL_MESSAGE, isValidPhotoUrl } from './photoUrl';

// api §3 UpdateMeDto: firstName/lastName (max 100), optional international
// phone, optional photoUrl (@IsUrl). Built per account type: a CHILD account's
// form renders no name/phone inputs (fe §7.2), so those fields must not be
// validated there — only photoUrl and notification prefs apply.
export function buildAccountProfileSchema(isChild: boolean) {
  return z.object({
    firstName: isChild ? z.string() : personNameSchema('First name'),
    lastName: isChild ? z.string() : personNameSchema('Last name'),
    phone: isChild ? z.string().optional() : optionalPhoneSchema,
    photoUrl: z
      .string()
      .trim()
      .max(2048, 'Photo URL must be 2048 characters or fewer.')
      .refine((value) => !value || isValidPhotoUrl(value), INVALID_PHOTO_URL_MESSAGE),
    emailNotifications: z.boolean(),
    smsNotifications: z.boolean(),
  });
}

export type AccountProfileFormValues = z.infer<ReturnType<typeof buildAccountProfileSchema>>;
