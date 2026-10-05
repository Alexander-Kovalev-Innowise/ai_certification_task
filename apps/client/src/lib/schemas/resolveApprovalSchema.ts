import { z } from 'zod';

import { optionalTextSchema } from './optionalFields';

// api §4.6 `ResolveApprovalDto` — `{ notes?: string }`, max 1000, shared by
// POST /approvals/:id/approve and /deny.
export const resolveApprovalSchema = z.object({
  notes: optionalTextSchema('Notes', 1000),
});

export type ResolveApprovalFormValues = z.infer<typeof resolveApprovalSchema>;
