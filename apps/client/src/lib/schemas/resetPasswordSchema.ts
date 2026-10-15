import { z } from 'zod';

import { passwordPolicySchema } from './passwordPolicy';

// api §1 ResetPasswordDto: `{ token, newPassword }` — `token` comes from
// the `?token=` query param, not a form field, so the schema only covers
// what the user actually types.
export const resetPasswordSchema = z.object({
  newPassword: passwordPolicySchema,
});

export type ResetPasswordFormValues = z.infer<typeof resetPasswordSchema>;
