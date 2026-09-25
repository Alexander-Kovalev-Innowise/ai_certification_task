import { z } from 'zod';

// api §4.1 `UpdateBrandingDto`, reproduced: `logoUrl?: string` (pre-uploaded
// via `POST /storage/logo`, never typed by the user — fe §7.1), `hex`
// regex identical to the server's `@Matches(/^#[0-9A-Fa-f]{6}$/)`. Task 17.1.
// `resetToDefault` is not exposed as a form field in this phase's UI (no
// "reset branding" control in the plan's file list) but the schema still
// mirrors the DTO's optional shape for the field, matching the "schemas
// mirror class-validator DTOs one-to-one" rule (fe §7).
const HEX_COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;

export const updateBrandingSchema = z.object({
  primaryColorHex: z.string().regex(HEX_COLOR_PATTERN, 'Enter a valid hex color, e.g. #6EE7B7.'),
  logoUrl: z.string().url('Logo URL must be valid.').optional().or(z.literal('')),
});

export type UpdateBrandingFormValues = z.infer<typeof updateBrandingSchema>;
