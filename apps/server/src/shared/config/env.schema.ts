import { z } from 'zod';

/**
 * Parses a "true"/"false" string env var into a real boolean, defaulting when
 * the var is unset. `z.coerce.boolean()` is deliberately NOT used here — it
 * coerces via JS truthiness, so the string "false" would coerce to `true`.
 */
function booleanFromString(defaultValue: boolean) {
  return z
    .string()
    .optional()
    .transform((val) => (val === undefined ? defaultValue : val === 'true'));
}

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  JWT_SECRET: z.string().min(1, 'JWT_SECRET is required'),
  PORT: z
    .string()
    .optional()
    .default('3000')
    .transform((val) => Number(val))
    .pipe(z.number().int().positive()),
  // SCHEDULER_ENABLED: boolean, default true (arch §13.1 emergency valve —
  // set to "false" to disable the in-process @nestjs/schedule cron on a
  // given instance without a code change).
  SCHEDULER_ENABLED: booleanFromString(true),
  // Not in the plan's Task 0.8 var list, added in Task 0.11 — the single
  // client origin CORS needs (arch §5 step 1). Defaults to the client's dev
  // port so a bare `docker compose up -d && npm run dev` works out of the
  // box without every contributor adding this to their local .env.
  CLIENT_URL: z.string().min(1).default('http://localhost:3000'),
  // Not in the plan's Task 0.8 var list, added in Task 1.10 — MailModule
  // (shared/mail) reads this to pick the MailService adapter (INT-001's
  // "pluggable provider" requirement). Defaults to 'console' since the SES
  // adapter is a stub in Epic-01 (out of functional scope) — every
  // environment gets the console adapter until a real provider is wired.
  MAIL_PROVIDER: z.enum(['console', 'ses']).default('console'),
  // Not in the plan's Task 0.8 var list, added in Task 1.11 — same
  // config-keyed useClass pattern as MAIL_PROVIDER (arch §13: "Ports, not
  // providers... bound by token in the module's useClass factory keyed off
  // config"). Defaults to 'local' since the S3 adapter is a stub.
  STORAGE_PROVIDER: z.enum(['local', 's3']).default('local'),
});

export type EnvConfig = z.infer<typeof envSchema>;

export function validateEnv(env: Record<string, string | undefined>): EnvConfig {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    throw new Error(`Invalid environment configuration: ${result.error.message}`);
  }
  return result.data;
}
