import { z } from 'zod';

import { optionalHttpUrlSchema, optionalTextSchema } from './optionalFields';

// api §4.1 `UpdateTrainerDto` (PATCH /trainers/:id): businessName max200,
// address max500, website URL, description max2000. The server's `@IsUrl()`
// requires a real hostname with a TLD, so the client rejects `http://x` too
// rather than letting it round-trip into a 400.
export const updateTrainerBusinessSchema = z.object({
  businessName: z.string().trim().min(1, 'Business name is required.').max(200, 'Business name must be 200 characters or fewer.'),
  address: optionalTextSchema('Address', 500),
  website: optionalHttpUrlSchema('Website').refine((value) => {
    if (value === '') {
      return true;
    }
    try {
      return new URL(value).hostname.includes('.');
    } catch {
      return false;
    }
  }, 'Enter a full website address, e.g. https://example.com.'),
  description: optionalTextSchema('Description', 2000),
});

export type UpdateTrainerBusinessFormValues = z.infer<typeof updateTrainerBusinessSchema>;
