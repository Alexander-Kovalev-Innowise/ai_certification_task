import { z } from 'zod';

import { optionalUuidSchema } from './optionalFields';

// api §2 GET /impersonation/history `?adminUserId&targetUserId&dateFrom&dateTo`.
// User ids are Prisma `@default(uuid())` values; every field is optional (empty
// string = no filter).
export const historyFiltersSchema = z
  .object({
    adminUserId: optionalUuidSchema('Admin user ID'),
    targetUserId: optionalUuidSchema('Target user ID'),
    dateFrom: z.string(),
    dateTo: z.string(),
  })
  .superRefine((values, ctx) => {
    if (values.dateFrom && values.dateTo && values.dateFrom > values.dateTo) {
      ctx.addIssue({ code: 'custom', path: ['dateTo'], message: 'End date must be on or after the start date.' });
    }
  });

export type HistoryFiltersFormValues = z.infer<typeof historyFiltersSchema>;
