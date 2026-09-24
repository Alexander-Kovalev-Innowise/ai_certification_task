import { z } from 'zod';

// fe §11.1/§4.3, api §4.1 CreateTrainerDto, reproduced exactly:
// businessName max200, firstName max100, lastName max100, valid email,
// E.164-ish phone. Two name fields — RESOLVED 2026-09-22, not a single
// "Trainer Name" input.
const E164_PATTERN = /^\+?[1-9]\d{1,14}$/;

export const createTrainerSchema = z.object({
  businessName: z.string().min(1, 'Business name is required.').max(200, 'Business name must be 200 characters or fewer.'),
  firstName: z.string().min(1, 'First name is required.').max(100, 'First name must be 100 characters or fewer.'),
  lastName: z.string().min(1, 'Last name is required.').max(100, 'Last name must be 100 characters or fewer.'),
  email: z.string().min(1, 'Email is required.').max(255).email('Enter a valid email address.'),
  phone: z.string().min(1, 'Phone number is required.').regex(E164_PATTERN, 'Enter a valid phone number (E.164 format, e.g. +14155552671).'),
});

export type CreateTrainerFormValues = z.infer<typeof createTrainerSchema>;
