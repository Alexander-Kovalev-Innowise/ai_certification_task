import { z } from 'zod';

import { emailSchema, personNameSchema } from './common';
import { requiredPhoneSchema } from './phone';

// fe §11.1/§4.3, api §4.1 CreateTrainerDto: businessName max200, firstName
// max100, lastName max100, valid email, valid international phone. Two name
// fields — RESOLVED 2026-09-22, not a single "Trainer Name" input.
export const createTrainerSchema = z.object({
  businessName: z.string().trim().min(1, 'Business name is required.').max(200, 'Business name must be 200 characters or fewer.'),
  firstName: personNameSchema('First name'),
  lastName: personNameSchema('Last name'),
  email: emailSchema,
  phone: requiredPhoneSchema,
});

export type CreateTrainerFormValues = z.infer<typeof createTrainerSchema>;
