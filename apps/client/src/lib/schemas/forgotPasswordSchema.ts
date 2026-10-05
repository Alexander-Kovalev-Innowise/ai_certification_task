import { z } from 'zod';

import { emailSchema } from './common';

// api §1 ForgotPasswordDto: `{ email: string }` (@IsEmail).
export const forgotPasswordSchema = z.object({
  email: emailSchema,
});

export type ForgotPasswordFormValues = z.infer<typeof forgotPasswordSchema>;
