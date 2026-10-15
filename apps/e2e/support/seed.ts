import * as env from '../scripts/e2e-env.cjs';

/**
 * Seeded fixtures. The Super Admin is created by `apps/server/prisma/seed.ts`
 * from SEED_SUPER_ADMIN_EMAIL / SEED_SUPER_ADMIN_PASSWORD, which are read here
 * (never printed) from the process env or the root .env.
 */
const creds = env.seedCredentials();
if (!creds.email || !creds.password) {
  throw new Error('SEED_SUPER_ADMIN_EMAIL / SEED_SUPER_ADMIN_PASSWORD are not set (root .env or process env).');
}

export const SEED = {
  superAdmin: { email: creds.email, password: creds.password },
} as const;

export const API_URL = env.API_URL;
export const CLIENT_URL = env.CLIENT_URL;
