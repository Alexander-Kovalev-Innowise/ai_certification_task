import { z } from 'zod';

import { emailSchema } from './common';
import { optionalPersonNameSchema, optionalTextSchema } from './optionalFields';

// api §4.2 `InviteCoachDto` — email (valid, max255), name? max200, message?
// max1000.
export const inviteCoachSchema = z.object({
  email: emailSchema,
  name: optionalPersonNameSchema('Name', 200),
  message: optionalTextSchema('Message', 1000),
});

export type InviteCoachFormValues = z.infer<typeof inviteCoachSchema>;
