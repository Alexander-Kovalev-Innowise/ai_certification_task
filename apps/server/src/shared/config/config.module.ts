import { resolve } from 'node:path';

import { Global, Module } from '@nestjs/common';
import { config as loadDotenv } from 'dotenv';

import { validateEnv, type EnvConfig } from './env.schema';

// process.cwd() is apps/server when run via `npm run dev -w apps/server` /
// `turbo run dev`, so this resolves to the project root regardless of
// whether the process runs from src (ts-node) or dist (compiled) — it's a
// cwd-relative path, not __dirname-relative, so build output depth never
// affects it.
loadDotenv({ path: resolve(process.cwd(), '../../.env') });

// Validated at module load (application boot) — throws synchronously on
// invalid/missing required env vars, per Task 0.8's DoD. Exported directly
// (not just via the DI token below) so main.ts can read it before the Nest
// DI container exists yet — importing this file is what triggers the
// dotenv load + validation, regardless of whether anything wires
// ConfigModule into AppModule's imports.
export const env = validateEnv(process.env);

export const ENV_CONFIG = Symbol('ENV_CONFIG');

@Global()
@Module({
  providers: [
    {
      provide: ENV_CONFIG,
      useValue: env,
    },
  ],
  exports: [ENV_CONFIG],
})
export class ConfigModule {}

export type { EnvConfig };
