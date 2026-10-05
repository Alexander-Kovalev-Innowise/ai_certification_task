import { z } from 'zod';

import { emailSchema } from './common';
import { passwordPolicySchema } from './passwordPolicy';

// POST /player-profiles/:id/child-login — `{ email, password }`.
export const createChildLoginSchema = z.object({
  email: emailSchema,
  password: passwordPolicySchema,
});

export type CreateChildLoginFormValues = z.infer<typeof createChildLoginSchema>;

// POST /player-profiles/:id/child-login/reset-password — `{ password }`.
export const resetChildLoginPasswordSchema = z.object({
  password: passwordPolicySchema,
});

export type ResetChildLoginPasswordFormValues = z.infer<typeof resetChildLoginPasswordSchema>;
