import { resolve } from 'node:path';

import { config as loadDotenv } from 'dotenv';
import { defineConfig } from 'prisma/config';

// Deviation from the plan (Prisma 7.10.0, pinned in Phase 0): Prisma 7 moved
// the datasource connection string out of schema.prisma and into this config
// file, read by the CLI (`generate`/`migrate`/`format`/`studio`). Same root
// `.env` loading convention as `shared/config/config.module.ts` (Task 0.8):
// process.cwd() is `apps/server` for every workspace script, so this resolves
// to the project root regardless of ts-node/dist depth.
loadDotenv({ path: resolve(process.cwd(), '../../.env') });

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: process.env.DATABASE_URL,
  },
});
