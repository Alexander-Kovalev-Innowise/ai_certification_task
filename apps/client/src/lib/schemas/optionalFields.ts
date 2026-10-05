import { z } from 'zod';

import { emailSchema, personNameSchema } from './common';

// Shared builders for OPTIONAL text-ish form fields. Every one of them takes
// an empty string as "not provided" (form inputs are always strings, never
// undefined, once `defaultValues` are set) and only validates when the user
// actually typed something.

export function optionalTextSchema(label: string, max: number) {
  return z.string().trim().max(max, `${label} must be ${max} characters or fewer.`);
}

function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

export function optionalHttpUrlSchema(label: string, max = 2048) {
  return z
    .string()
    .trim()
    .max(max, `${label} must be ${max} characters or fewer.`)
    .refine((value) => value === '' || isHttpUrl(value), `${label} must be a valid link starting with http:// or https://.`);
}

// Re-uses personNameSchema's rules (so the two never drift) but lets an empty
// value through.
export function optionalPersonNameSchema(label: string, max = 100) {
  const required = personNameSchema(label, max);
  return z.string().superRefine((value, ctx) => {
    if (!value.trim()) {
      return;
    }
    const result = required.safeParse(value);
    if (!result.success) {
      for (const issue of result.error.issues) {
        ctx.addIssue({ code: 'custom', message: issue.message });
      }
    }
  });
}

export function optionalEmailSchema() {
  return z.string().superRefine((value, ctx) => {
    if (!value.trim()) {
      return;
    }
    const result = emailSchema.safeParse(value);
    if (!result.success) {
      for (const issue of result.error.issues) {
        ctx.addIssue({ code: 'custom', message: issue.message });
      }
    }
  });
}

// Prisma `@default(uuid())` ids. Deliberately version-agnostic (any 8-4-4-4-12
// hex UUID) so it accepts whatever the database actually stores.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function optionalUuidSchema(label: string) {
  return z
    .string()
    .trim()
    .refine((value) => value === '' || UUID_PATTERN.test(value), `${label} must be a valid ID (e.g. 3f2b8c1e-5a4d-4b6f-9c7e-1d2a3b4c5d6e).`);
}
