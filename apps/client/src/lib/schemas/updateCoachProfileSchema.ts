import { z } from 'zod';

import { optionalTextSchema } from './optionalFields';

// api §4.2 `UpdateCoachDto` self-fields branch — bio/credentials/certifications
// each max 2000 (`publicProfile` is a separate optimistic toggle, not part of
// this form's submit).
export const updateCoachProfileSchema = z.object({
  bio: optionalTextSchema('Bio', 2000),
  credentials: optionalTextSchema('Credentials', 2000),
  certifications: optionalTextSchema('Certifications', 2000),
});

export type UpdateCoachProfileFormValues = z.infer<typeof updateCoachProfileSchema>;
