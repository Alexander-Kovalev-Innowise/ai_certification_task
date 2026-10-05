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

const baseEnvSchema = z.object({
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
  CLIENT_URL: z.string().min(1).default('http://localhost:3001'),
  // Not in the plan's Task 0.8 var list, added in Task 1.10 — MailModule
  // (shared/mail) reads this to pick the MailService adapter (INT-001's
  // "pluggable provider" requirement). Defaults to 'console' since the SES
  // adapter is a stub in Epic-01 (out of functional scope) — every
  // environment gets the console adapter until a real provider is wired.
  //
  // Extended: `smtp` (nodemailer, needs SMTP_URL + MAIL_FROM) and `dev` (an
  // in-memory ring buffer exposed at GET /__dev/mailbox — registered only
  // when NODE_ENV !== 'production', for the Playwright e2e suite).
  MAIL_PROVIDER: z.enum(['console', 'ses', 'smtp', 'dev']).default('console'),
  // Only validated/required when MAIL_PROVIDER=smtp (see superRefine below).
  // SMTP_URL is a nodemailer connection URL, e.g. `smtp://user:pass@host:587`
  // — it may embed credentials, so it is never logged.
  SMTP_URL: z.string().min(1).optional(),
  MAIL_FROM: z.string().min(1).optional(),
  // RATE_LIMITS_DISABLED: skips every @nestjs/throttler throttle. Only honoured
  // when NODE_ENV !== 'production' (see `areRateLimitsDisabled`) — a stray
  // value in a production environment is inert by construction.
  RATE_LIMITS_DISABLED: booleanFromString(false),
  // Not in the plan's Task 0.8 var list, added in Task 1.11 — same
  // config-keyed useClass pattern as MAIL_PROVIDER (arch §13: "Ports, not
  // providers... bound by token in the module's useClass factory keyed off
  // config"). Defaults to 'local' since the S3 adapter is a stub.
  STORAGE_PROVIDER: z.enum(['local', 's3']).default('local'),
  // Directory the local storage adapter writes uploaded logos/photos to
  // (resolved relative to the process cwd, i.e. apps/server). Served back
  // publicly at /uploads/* by UploadsController.
  UPLOADS_DIR: z.string().min(1).default('uploads'),
  // Public, absolute base URL of this API as browsers reach it. Storage URLs
  // handed to the client are built from it (`<PUBLIC_API_URL>/uploads/<key>`)
  // so <img src> works cross-origin. Defaults to http://localhost:<PORT>.
  PUBLIC_API_URL: z.string().min(1).optional(),
});

export const envSchema = baseEnvSchema
  .superRefine((value, ctx) => {
    if (value.MAIL_PROVIDER !== 'smtp') {
      return;
    }
    for (const key of ['SMTP_URL', 'MAIL_FROM'] as const) {
      if (!value[key]) {
        ctx.addIssue({ code: 'custom', path: [key], message: `${key} is required when MAIL_PROVIDER=smtp` });
      }
    }
  })
  .transform((cfg) => ({
    ...cfg,
    PUBLIC_API_URL: (cfg.PUBLIC_API_URL ?? `http://localhost:${cfg.PORT}`).replace(/\/+$/, ''),
  }));

export type EnvConfig = z.infer<typeof envSchema>;

/**
 * Single source of truth for "are throttles skipped?". Never true in
 * production, whatever RATE_LIMITS_DISABLED says.
 */
export function areRateLimitsDisabled(config: Pick<EnvConfig, 'NODE_ENV' | 'RATE_LIMITS_DISABLED'>): boolean {
  return config.RATE_LIMITS_DISABLED && config.NODE_ENV !== 'production';
}

/** Whether the in-memory dev mailbox (MAIL_PROVIDER=dev) may exist. Never in production. */
export function isDevMailboxEnabled(config: Pick<EnvConfig, 'NODE_ENV' | 'MAIL_PROVIDER'>): boolean {
  return config.MAIL_PROVIDER === 'dev' && config.NODE_ENV !== 'production';
}

export function validateEnv(env: Record<string, string | undefined>): EnvConfig {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    throw new Error(`Invalid environment configuration: ${result.error.message}`);
  }
  return result.data;
}
