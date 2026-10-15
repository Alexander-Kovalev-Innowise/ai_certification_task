import { z } from 'zod';

// POST /coaches/:id/availability/overrides/:oid/request-change — `{ message }`, 5-500 characters.
export const requestOverrideChangeSchema = z.object({
  message: z
    .string()
    .trim()
    .min(5, 'Please write at least 5 characters.')
    .max(500, 'Message must be 500 characters or fewer.'),
});

export type RequestOverrideChangeFormValues = z.infer<typeof requestOverrideChangeSchema>;
