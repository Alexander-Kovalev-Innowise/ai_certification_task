import { z } from 'zod';

import { personNameSchema } from './common';
import { optionalPhoneSchema } from './phone';

// api §3 `UpdateUserDto` (the slice UserDetailForm edits): firstName/lastName
// max100, phone a valid international number (server `@IsPhoneNumber()`).
export const userDetailSchema = z.object({
  firstName: personNameSchema('First name'),
  lastName: personNameSchema('Last name'),
  phone: optionalPhoneSchema,
});

export type UserDetailFormValues = z.infer<typeof userDetailSchema>;
