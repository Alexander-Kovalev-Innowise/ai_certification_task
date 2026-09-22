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
});

export type EnvConfig = z.infer<typeof envSchema>;

export function validateEnv(env: Record<string, string | undefined>): EnvConfig {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    throw new Error(`Invalid environment configuration: ${result.error.message}`);
  }
  return result.data;
}
