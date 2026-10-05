import { z } from 'zod';

// POST /approvals/:id/request-info — `{ message }`, required, max 1000.
export const requestInfoSchema = z.object({
  message: z.string().trim().min(1, 'Write a short question for your child.').max(1000, 'Message must be 1000 characters or fewer.'),
});

export type RequestInfoFormValues = z.infer<typeof requestInfoSchema>;
