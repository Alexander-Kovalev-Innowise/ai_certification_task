import { z } from 'zod';

import { passwordPolicySchema } from './passwordPolicy';

// api §1 ChangePasswordDto: `{ currentPassword?, newPassword }` —
// `currentPassword` is required only on the voluntary path (server:
// "required unless user.mustChangePassword === true"). Task 11.6's dual-mode
// component renders the field at all only in that voluntary case, so the
// schema is built per-mode rather than always-optional + a manual check —
// the forced path's form literally has no `currentPassword` input to fail
// validation on.
export function buildChangePasswordSchema(requireCurrentPassword: boolean) {
  return z.object({
    currentPassword: requireCurrentPassword
      ? z.string().min(1, 'Current password is required.')
      : z.string().optional(),
    newPassword: passwordPolicySchema,
  });
}

export type ChangePasswordFormValues = z.infer<ReturnType<typeof buildChangePasswordSchema>>;
