import { z } from 'zod';

import { passwordPolicySchema } from './passwordPolicy';

// api §1 CompleteTrainerSetupDto: `{ setupToken, password }` — `setupToken`
// comes from the `?token=` query param, not a form field.
export const completeTrainerSetupSchema = z.object({
  password: passwordPolicySchema,
});

export type CompleteTrainerSetupFormValues = z.infer<typeof completeTrainerSetupSchema>;
