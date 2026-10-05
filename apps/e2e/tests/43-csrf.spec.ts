import type { APIRequestContext, Page } from '@playwright/test';

import { test, expect, highlight, shell, createTrainer } from '../support/test';
import { API_URL, CLIENT_URL } from '../support/seed';

/**
 * Spec section 13 - CSRF defence for the two cookie-authenticated, state-changing calls:
 *   POST /auth/refresh  needs a same-site `Origin` header (== CLIENT_URL; Referer is only used when Origin is absent)
 *   POST /auth/logout   needs the same Origin AND `X-CSRF-Token` equal to the `csrf` cookie (double-submit)
 * Otherwise 403 CSRF_MISMATCH. Logout while impersonating is 403 IMPERSONATION_NOT_ALLOWED (the browser's cookies belong to the admin).
 * The API-level tests use a Playwright APIRequestContext (cookie jar like a browser, but every header is explicit);
 * a short browser scene keeps the video meaningful, and the UI tests prove the real client sends what the server requires.
 */
test.describe('CSRF defence on /auth/refresh and /auth/logout', () => {
  const ORIGIN = new URL(CLIENT_URL).origin;

  interface LoginBody {
    accessToken: string;
    csrfToken: string;
    user: { id: string; role: string };
  }

  async function login(ctx: APIRequestContext, email: string, password: string): Promise<LoginBody> {
    const res = await ctx.post('/auth/login', { data: { email, password }, headers: { Origin: ORIGIN } });
    expect(res.status(), await res.text()).toBeLessThan(300);
    return (await res.json()) as LoginBody;
  }

  async function errorCodeOf(res: { json(): Promise<unknown> }): Promise<string | undefined> {
    return ((await res.json().catch(() => ({}))) as { errorCode?: string }).errorCode;
  }

  /** Shows something real in the recording while the API-level checks run. */
  async function showLogin(page: Page, narrate: (t: string) => Promise<void>, text: string) {
    await page.goto('/login');
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
    await narrate(text);
  }

  test('POST /auth/refresh: a missing, foreign, look-alike or "null" Origin is rejected with 403 CSRF_MISMATCH; the real client origin works', async ({
    page,
    playwright,
    api,
    mailbox,
    narrate,
  }) => {
    const trainer = await createTrainer(api, mailbox);
    const ctx = await playwright.request.newContext({ baseURL: API_URL });
    try {
      await showLogin(page, narrate, 'API-level check (no browser involved): refresh with a valid refresh cookie but different Origin headers');
      const first = await login(ctx, trainer.email, trainer.password);

      const rejected: Array<[string, Record<string, string>]> = [
        ['no Origin or Referer (curl-style caller)', {}],
        ['foreign Origin', { Origin: 'https://evil.example' }],
        ['look-alike sub-domain', { Origin: `${ORIGIN.replace('://', '://evil.')}` }],
        ['look-alike suffix', { Origin: `${ORIGIN}.evil.example` }],
        ['same host, other port', { Origin: 'http://localhost:9999' }],
        ['opaque Origin: null', { Origin: 'null' }],
        ['foreign Referer only', { Referer: 'https://evil.example/page' }],
        ['wrong Origin wins over a correct Referer', { Origin: 'https://evil.example', Referer: `${ORIGIN}/dashboard` }],
      ];
      for (const [label, headers] of rejected) {
        const res = await ctx.post('/auth/refresh', { headers });
        expect(res.status(), `refresh with ${label}`).toBe(403);
        expect(await errorCodeOf(res), `refresh with ${label}`).toBe('CSRF_MISMATCH');
      }

      await narrate('None of the 8 forged attempts touched the session: the real origin still refreshes');
      const ok = await ctx.post('/auth/refresh', { headers: { Origin: ORIGIN } });
      expect(ok.status(), await ok.text()).toBe(200);
      const refreshed = (await ok.json()) as LoginBody;
      expect(refreshed.accessToken).toBeTruthy();
      expect(refreshed.csrfToken).toBeTruthy();
      expect(refreshed.csrfToken).not.toBe(first.csrfToken); // rotated

      await narrate('A correct Referer is accepted when the Origin header is absent');
      const viaReferer = await ctx.post('/auth/refresh', { headers: { Referer: `${ORIGIN}/dashboard` } });
      expect(viaReferer.status(), await viaReferer.text()).toBe(200);

      await narrate('A trailing slash or path in Origin does not matter: only the origin is compared');
      const withSlash = await ctx.post('/auth/refresh', { headers: { Origin: `${ORIGIN}/` } });
      expect(withSlash.status()).toBe(200);
      await highlight(page.getByRole('button', { name: 'Sign in' }));
    } finally {
      await ctx.dispose();
    }
  });

  test('POST /auth/logout: needs the right Origin AND a matching X-CSRF-Token; only then 204 and the session is revoked', async ({
    page,
    playwright,
    api,
    mailbox,
    narrate,
  }) => {
    const trainer = await createTrainer(api, mailbox);
    const ctx = await playwright.request.newContext({ baseURL: API_URL });
    try {
      await showLogin(page, narrate, 'API-level check: logout with every combination of Origin and X-CSRF-Token');
      const session = await login(ctx, trainer.email, trainer.password);
      const bearer = { Authorization: `Bearer ${session.accessToken}` };

      const rejected: Array<[string, Record<string, string>]> = [
        ['no Origin, no token', { ...bearer }],
        ['no Origin, right token', { ...bearer, 'X-CSRF-Token': session.csrfToken }],
        ['foreign Origin, right token', { ...bearer, Origin: 'https://evil.example', 'X-CSRF-Token': session.csrfToken }],
        ['right Origin, no token', { ...bearer, Origin: ORIGIN }],
        ['right Origin, empty token', { ...bearer, Origin: ORIGIN, 'X-CSRF-Token': '' }],
        ['right Origin, wrong token', { ...bearer, Origin: ORIGIN, 'X-CSRF-Token': 'not-the-csrf-cookie-value' }],
        ['right Origin, almost-right token', { ...bearer, Origin: ORIGIN, 'X-CSRF-Token': `${session.csrfToken}x` }],
      ];
      for (const [label, headers] of rejected) {
        const res = await ctx.post('/auth/logout', { headers });
        expect(res.status(), `logout with ${label}`).toBe(403);
        expect(await errorCodeOf(res), `logout with ${label}`).toBe('CSRF_MISMATCH');
      }

      await narrate('After 7 rejected attempts the session is still alive (refresh works)');
      const stillAlive = await ctx.post('/auth/refresh', { headers: { Origin: ORIGIN } });
      expect(stillAlive.status(), await stillAlive.text()).toBe(200);
      const live = (await stillAlive.json()) as LoginBody; // refresh rotated the csrf cookie and the token

      await narrate('The old token no longer matches the rotated cookie; the current one does');
      const stale = await ctx.post('/auth/logout', { headers: { Authorization: `Bearer ${live.accessToken}`, Origin: ORIGIN, 'X-CSRF-Token': session.csrfToken } });
      expect(stale.status()).toBe(403);
      const good = await ctx.post('/auth/logout', { headers: { Authorization: `Bearer ${live.accessToken}`, Origin: ORIGIN, 'X-CSRF-Token': live.csrfToken } });
      expect(good.status(), await good.text()).toBe(204);

      await narrate('Logged out: the refresh cookie is revoked, refresh now answers 401');
      const after = await ctx.post('/auth/refresh', { headers: { Origin: ORIGIN } });
      expect(after.status()).toBe(401);
      await highlight(page.getByRole('button', { name: 'Sign in' }));
    } finally {
      await ctx.dispose();
    }
  });

  test('logout while impersonating is refused (403 IMPERSONATION_NOT_ALLOWED) and does not revoke the admin\'s session; the UI hides "Sign out" and exit comes first', async ({
    page,
    playwright,
    api,
    mailbox,
    seed,
    narrate,
    loginAs,
  }) => {
    const trainer = await createTrainer(api, mailbox);
    const fullName = `${trainer.firstName} ${trainer.lastName}`;
    const ctx = await playwright.request.newContext({ baseURL: API_URL });
    try {
      await narrate('Super Admin impersonates the trainer through the UI');
      await loginAs(seed.superAdmin.email, seed.superAdmin.password);
      const app = shell(page);
      await app.goTo('Users');
      await page.getByLabel('Search').fill(trainer.email);
      await page.getByRole('table', { name: 'Users' }).getByRole('row', { name: fullName }).getByRole('link', { name: 'Edit user' }).click();
      await page.getByRole('button', { name: 'Impersonate', exact: true }).click();
      await page.getByRole('dialog', { name: `Impersonate ${fullName}?` }).getByRole('button', { name: 'Impersonate', exact: true }).click();
      const banner = page.getByTestId('impersonation-banner');
      await expect(banner).toContainText(`Viewing as ${fullName} (TRAINER)`);

      await narrate('While impersonating there is no "Sign out" in the account menu');
      await app.openUserMenu();
      await expect(page.getByRole('menuitem', { name: 'Sign out' })).toHaveCount(0);
      await highlight(page.getByRole('menu'));
      await page.keyboard.press('Escape');

      await narrate('Exit Impersonation in the UI, then sign out normally as the Super Admin');
      await banner.getByRole('button', { name: 'Exit Impersonation' }).click();
      await expect(banner).toBeHidden({ timeout: 15_000 });
      await expect(app.userMenuButton).toContainText('Super Admin');
      await app.signOut();
      await expect(page).toHaveURL(/\/login/);

      await showLogin(page, narrate, "API level: an impersonation token plus the admin's own cookie and CSRF token is still refused");
      const admin = await login(ctx, seed.superAdmin.email, seed.superAdmin.password);
      const start = await ctx.post('/impersonation/start', {
        headers: { Authorization: `Bearer ${admin.accessToken}` },
        data: { targetUserId: trainer.userId },
      });
      expect(start.status(), await start.text()).toBeLessThan(300);
      const impersonation = (await start.json()) as { accessToken: string };
      const refused = await ctx.post('/auth/logout', {
        headers: { Authorization: `Bearer ${impersonation.accessToken}`, Origin: ORIGIN, 'X-CSRF-Token': admin.csrfToken },
      });
      expect(refused.status()).toBe(403);
      expect(await errorCodeOf(refused)).toBe('IMPERSONATION_NOT_ALLOWED');

      await narrate('The admin\'s own session was NOT revoked');
      const adminRefresh = await ctx.post('/auth/refresh', { headers: { Origin: ORIGIN } });
      expect(adminRefresh.status(), await adminRefresh.text()).toBe(200);
      const end = await ctx.post('/impersonation/end', { headers: { Authorization: `Bearer ${impersonation.accessToken}` } });
      expect(end.status()).toBeLessThan(300);
    } finally {
      await ctx.dispose();
    }
  });

  test('real browser: a page reload keeps the session (refresh sends the Origin) and Sign out sends Origin + X-CSRF-Token and ends it', async ({
    page,
    api,
    mailbox,
    narrate,
    loginAs,
  }) => {
    const trainer = await createTrainer(api, mailbox);
    await loginAs(trainer.email, trainer.password);
    await expect(page.getByRole('heading', { name: `Welcome, ${trainer.firstName}` })).toBeVisible();

    await narrate('Reload: the client silently refreshes with the cookie - the page stays signed in');
    const refreshResponse = page.waitForResponse((r) => r.url().endsWith('/auth/refresh') && r.request().method() === 'POST');
    await page.reload();
    const refresh = await refreshResponse;
    expect(refresh.status()).toBe(200);
    const refreshHeaders = await refresh.request().allHeaders();
    expect(refreshHeaders['origin']).toBe(ORIGIN);
    await expect(page.getByRole('heading', { name: `Welcome, ${trainer.firstName}` })).toBeVisible();
    await highlight(shell(page).userMenuButton);

    await narrate('Sign out straight after the reload: the in-memory CSRF token from the refresh is sent');
    const logoutResponse = page.waitForResponse((r) => r.url().includes('/auth/logout') && r.request().method() === 'POST');
    await shell(page).signOut();
    const logout = await logoutResponse;
    expect(logout.status()).toBe(204);
    const logoutHeaders = await logout.request().allHeaders();
    expect(logoutHeaders['origin']).toBe(ORIGIN);
    expect(logoutHeaders['x-csrf-token']).toBeTruthy();
    await expect(page).toHaveURL(/\/login/);

    await narrate('The session is really gone: opening the dashboard sends the visitor back to the login page');
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
  });

  test('real browser: a forged refresh from a same-site attacker origin carries the cookie but is rejected, so the victim session is not rotated', async ({
    page,
    api,
    mailbox,
    narrate,
    loginAs,
  }) => {
    const trainer = await createTrainer(api, mailbox);
    await loginAs(trainer.email, trainer.password);
    await expect(page.getByRole('heading', { name: `Welcome, ${trainer.firstName}` })).toBeVisible();
    const refreshCookie = async () => (await page.context().cookies(`${API_URL}/auth/refresh`)).find((c) => c.name === 'refreshToken')?.value;
    const before = await refreshCookie();
    expect(before).toBeTruthy();

    await narrate('The victim is signed in; now they open an attacker page on a sibling origin (same site, other port)');
    await page.route('http://localhost:4000/**', (route) =>
      route.fulfill({ contentType: 'text/html', body: '<html><body style="font:24px system-ui;padding:40px"><h1>Totally harmless cat pictures</h1><p id="out">...</p></body></html>' }),
    );
    await page.goto('http://localhost:4000/');
    await expect(page.getByRole('heading', { name: 'Totally harmless cat pictures' })).toBeVisible();

    await narrate('The page silently POSTs /auth/refresh with the victim cookies; the browser stamps Origin: http://localhost:4000');
    const sent = page.waitForEvent('request', (r) => r.url() === `${API_URL}/auth/refresh`);
    await page.evaluate((url) => {
      void fetch(`${url}/auth/refresh`, { method: 'POST', credentials: 'include' }).catch(() => undefined);
    }, API_URL);
    const forged = await sent;
    expect((await forged.allHeaders())['origin']).toBe('http://localhost:4000');
    await page.waitForTimeout(1500);
    await page.evaluate(() => {
      document.getElementById('out')!.textContent = 'Forged POST /auth/refresh sent - the API must refuse it (403 CSRF_MISMATCH)';
    });
    await highlight(page.locator('#out'));

    await narrate('If the API had accepted it, the refresh token would have been rotated. It was not.');
    expect(await refreshCookie()).toBe(before);

    await narrate('Back in the real app a reload still works with the ORIGINAL refresh token: the victim stays signed in');
    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { name: `Welcome, ${trainer.firstName}` })).toBeVisible();
    await expect(page).not.toHaveURL(/\/login/);
  });
});
