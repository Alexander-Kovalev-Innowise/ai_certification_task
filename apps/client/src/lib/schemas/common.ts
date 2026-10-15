import { z } from 'zod';

// Letters (any script), combining marks, spaces, apostrophes, dots, hyphens.
const PERSON_NAME_PATTERN = /^\p{L}[\p{L}\p{M}' .-]*$/u;

export function personNameSchema(label: string, max = 100) {
  return z
    .string()
    .trim()
    .min(1, `${label} is required.`)
    .max(max, `${label} must be ${max} characters or fewer.`)
    .regex(PERSON_NAME_PATTERN, `${label} can only contain letters, spaces, hyphens and apostrophes.`);
}

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, 'Email is required.')
  .max(255, 'Email must be 255 characters or fewer.')
  .email('Enter a valid email address, e.g. name@example.com.');
