import { z } from 'zod';

import { emailSchema } from './common';

// api §1 LoginDto, mirrored exactly: @IsEmail() @MaxLength(255) email,
// @IsString() @IsNotEmpty() password — no strength check at login time
// (that's only enforced when a password is *set*, not when it's checked).
export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Password is required.'),
});

export type LoginFormValues = z.infer<typeof loginSchema>;
