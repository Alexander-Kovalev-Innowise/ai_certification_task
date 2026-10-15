import type { Page } from '@playwright/test';

import * as env from '../scripts/e2e-env.cjs';
import { test, expect, highlight, shell, startStrictStack, createTrainer, type StrictStack } from '../support/test';

/**
 * Two behaviours the main e2e stack deliberately switches off, shown against the "strict" API (:3102) + client (:3103):
 *   - spec "Login attempts should be rate-limited (prevent brute force)" - rate limits ON
 *     (auth-throttler.guard.ts: 5 logins / 15 min per e-mail, 20 / 15 min per IP);
 *   - spec US-01.07 "Impersonation session expires after 1 hour" - the lifetime is shortened with the non-production
 *     env var IMPERSONATION_TTL_SECONDS (45 s here) so the expiry can be watched in the video.
 * Users are arranged through the MAIN api (same database); only the browser talks to the strict pair.
 * The pair exists only for the duration of this file (support/strict-stack.ts) and starts with empty throttle counters.
 *
 * Order matters: the impersonation test signs the Super Admin in first; the rate-limit test goes last because it
 * deliberately exhausts the per-IP login budget of the strict API.
 */
test.use({ baseURL: env.STRICT_CLIENT_URL });

let stack: StrictStack;

test.beforeAll(async () => {
  test.setTimeout(480_000);
  stack = await startStrictStack();
});

test.afterAll(() => {
  stack?.stop();
});

async function submitLogin(page: Page, email: string, password: string) {
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

const mmss = (text: string | null): number => {
  const [m, s] = (text ?? '').trim().split(':').map(Number);
  return m * 60 + s;
};

test.describe('US-01.07: impersonation session expires', () => {
  test('the banner counts down, the session ends by itself at 0:00 and the audit history keeps the entry', async ({
    page,
    api,
    mailbox,
    seed,
    narrate,
    loginAs,
  }) => {
    const trainer = await createTrainer(api, mailbox);
    const fullName = `${trainer.firstName} ${trainer.lastName}`;
    const app = shell(page);
    const ttl = stack.impersonationTtlSeconds;

    await narrate(`This API runs with IMPERSONATION_TTL_SECONDS=${ttl} (the spec's 1 hour, shortened for the video)`);
    await loginAs(seed.superAdmin.email, seed.superAdmin.password);
    await app.goTo('Users');
    await page.getByLabel('Search').fill(trainer.email);
    await page.getByRole('table', { name: 'Users' }).getByRole('row', { name: fullName }).getByRole('link', { name: 'Edit user' }).click();

    await narrate('Start impersonating the trainer');
    await page.getByRole('button', { name: 'Impersonate', exact: true }).click();
    const started = page.waitForResponse((res) => res.url().endsWith('/impersonation/start') && res.request().method() === 'POST');
    await page.getByRole('dialog').getByRole('button', { name: 'Impersonate', exact: true }).click();
    const startBody = (await (await started).json()) as { accessToken: string; expiresIn: number };
    expect(startBody.expiresIn).toBe(ttl);

    const banner = page.getByTestId('impersonation-banner');
    const countdown = page.getByTestId('impersonation-countdown');
    await expect(banner).toContainText(`Viewing as ${fullName} (TRAINER)`);
    await expect(page.getByRole('heading', { name: `Welcome, ${trainer.firstName}` })).toBeVisible();
    await highlight(banner);

    await narrate('The countdown in the banner ticks down from the shortened lifetime');
    const first = mmss(await countdown.textContent());
    expect(first).toBeLessThanOrEqual(ttl);
    expect(first).toBeGreaterThan(5);
    await page.waitForTimeout(3000);
    const second = mmss(await countdown.textContent());
    expect(second).toBeLessThan(first);
    await highlight(countdown);

    await narrate('While the session lives, its token works as the trainer');
    const whileAlive = await stack.api.get<{ role: string; email: string }>('/me', { auth: startBody.accessToken });
    expect(whileAlive.status).toBe(200);
    expect(whileAlive.body).toMatchObject({ role: 'TRAINER', email: trainer.email });

    await narrate('Wait for 0:00: the portal leaves impersonation by itself - no click');
    await expect(banner).toBeHidden({ timeout: (ttl + 30) * 1000 });
    await expect(app.userMenuButton).toContainText('Super Admin');
    await expect(app.nav.getByRole('link', { name: 'Users', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: /Welcome, Super/ })).toBeVisible();
    await highlight(app.userMenuButton);

    await narrate('The expired token is dead');
    const afterExpiry = await stack.api.get('/me', { auth: startBody.accessToken });
    expect(afterExpiry.status).toBe(401);

    await narrate('Impersonation History still lists the session: admin, target, start time');
    await app.goTo('Impersonation History');
    await expect(page.getByRole('heading', { name: 'Impersonation History', level: 1 })).toBeVisible();
    const row = page
      .getByRole('table', { name: 'Impersonation history' })
      .getByRole('row')
      .filter({ hasText: `${fullName} (TRAINER)` })
      .first();
    await expect(row).toBeVisible();
    await expect(row).toContainText('Super Admin');
    await highlight(row);

    // The explicit POST /impersonation/end the banner sends at 0:00 is refused (the token has already expired); the
    // 10-minute ImpersonationMaintenanceJob (disabled on this stack) later closes such a row at exactly start + TTL.
    const admin = await stack.api.login(seed.superAdmin.email, seed.superAdmin.password).catch(() => null);
    if (admin) {
      const history = await stack.api.get<{ items: Array<{ target: { id: string }; startedAt: string; endedAt: string | null }> }>('/impersonation/history', {
        auth: admin,
        query: { targetUserId: trainer.userId },
      });
      expect(history.body.items).toHaveLength(1);
      expect(history.body.items[0].startedAt).toBeTruthy();
    }
  });
});

test.describe('Login brute-force protection (rate limits ON)', () => {
  test('5 wrong passwords for one e-mail lock that e-mail (429); another account is not affected; the IP cap is 20', async ({
    page,
    api,
    mailbox,
    narrate,
  }) => {
    const victim = await createTrainer(api, mailbox);
    const bystander = await createTrainer(api, mailbox);

    await narrate('The strict stack runs with rate limits ON (the normal e2e stack has them disabled)');
    await page.goto('/login');
    const invalid = page.getByRole('alert').filter({ hasText: 'Invalid email or password.' });
    const throttled = page.getByRole('alert').filter({ hasText: 'Too many attempts.' });

    await narrate('Attempts 1-5 with a wrong password: the usual "Invalid email or password."');
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      await submitLogin(page, victim.email, `Wrong-${attempt}-Password!`);
      await expect(invalid).toBeVisible();
      await expect(throttled).toHaveCount(0);
    }
    await highlight(invalid);

    await narrate('Attempt 6: the server answers 429 and the form shows the throttled message with the wait time');
    await submitLogin(page, victim.email, 'Wrong-6-Password!');
    await expect(throttled).toBeVisible();
    await expect(throttled).toContainText(/Please try again in \d+ seconds\./);
    await expect(invalid).toHaveCount(0);
    await highlight(throttled);
    const retryAfter = Number(/in (\d+) seconds/.exec((await throttled.textContent()) ?? '')?.[1]);
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(15 * 60);

    await narrate('Even the CORRECT password is refused while the e-mail is locked');
    await submitLogin(page, victim.email, victim.password);
    await expect(throttled).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
    const direct = await stack.api.post('/auth/login', { body: { email: victim.email, password: victim.password } });
    expect(direct.status).toBe(429);
    expect(Number(direct.headers.get('retry-after'))).toBeGreaterThan(0);

    await narrate('The lock is per e-mail: a different account signs in normally from the same browser');
    await submitLogin(page, bystander.email, bystander.password);
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 });
    await expect(shell(page).userMenuButton).toContainText(bystander.firstName);
    await highlight(shell(page).userMenuButton);
    await shell(page).signOut();
    await expect(page).toHaveURL(/\/login/);

    await narrate('Per-IP cap: after 20 login attempts from this IP in 15 minutes every account is throttled, valid or not');
    const statuses: number[] = [];
    for (let i = 0; i < 25 && !statuses.includes(429); i += 1) {
      const res = await stack.api.post('/auth/login', { body: { email: `nobody-${i}@e2e.test`, password: 'Wrong-Password-1!' } });
      statuses.push(res.status);
    }
    expect(statuses.at(-1)).toBe(429);
    expect(statuses.filter((status) => status === 401).length).toBeGreaterThan(0);

    const fresh = await createTrainer(api, mailbox);
    await page.goto('/login');
    await submitLogin(page, fresh.email, fresh.password);
    await expect(throttled).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
    await highlight(throttled);
  });
});
