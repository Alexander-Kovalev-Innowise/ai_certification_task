import type { FullConfig } from '@playwright/test';

import { ApiClient } from './support/api';
import { Mailbox } from './support/mailbox';
import { CLIENT_URL, SEED } from './support/seed';

/** Routes pre-compiled by `next dev` before the first test. Add routes your specs navigate to. */
const WARM_ROUTES = [
  '/login',
  '/forgot-password',
  '/reset-password',
  '/register',
  '/verify-email',
  '/change-password',
  '/dashboard',
  '/users',
  '/users/00000000-0000-0000-0000-000000000000',
  '/impersonation-history',
  '/account/profile',
  '/coaches',
  '/players',
  '/share-links',
  '/branding',
  '/my-times',
  '/profile',
  '/profiles',
  '/profiles/00000000-0000-0000-0000-000000000000',
  '/profiles/00000000-0000-0000-0000-000000000000/availability',
  '/approvals',
  '/join/warmup',
];

/**
 * Runs once after both webServers are up. (Database creation, `prisma migrate
 * deploy` and the Super Admin seed happen in scripts/start-api.cjs, because
 * Playwright boots webServers BEFORE globalSetup and the API needs a ready DB.)
 *
 * Here we only verify the stack is really usable and start from a clean mailbox,
 * so a broken environment fails fast with a clear message instead of 40 timeouts.
 */
export default async function globalSetup(_config: FullConfig): Promise<void> {
  const api = new ApiClient();
  if (!(await api.isUp())) throw new Error(`e2e API is not reachable at ${api.baseUrl}`);

  try {
    await api.login(SEED.superAdmin.email, SEED.superAdmin.password);
  } catch (e) {
    throw new Error(`Seeded Super Admin cannot log in on the e2e API/database: ${String(e)}`);
  }

  // `next dev` compiles each route on first hit (can take 10-30s) which makes
  // client-side navigations in the first test to touch a route time out. Warm them up.
  await Promise.all(
    WARM_ROUTES.map((route) =>
      fetch(new URL(route, CLIENT_URL), { signal: AbortSignal.timeout(180_000) }).catch((e) =>
        console.warn(`[e2e] warm-up of ${route} failed: ${String(e)}`),
      ),
    ),
  );

  const mailbox = new Mailbox();
  if (await mailbox.isAvailable()) {
    await mailbox.clear();
  } else {
    console.warn(
      '[e2e] WARNING: GET /__dev/mailbox is not available on the e2e API (MAIL_PROVIDER=dev not implemented yet?). ' +
        'Specs that read emails will fail until it is.',
    );
  }
}
