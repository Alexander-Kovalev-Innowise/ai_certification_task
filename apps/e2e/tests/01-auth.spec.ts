import { test, expect, highlight, shell } from '../support/test';

test.describe('Auth: sign in, session, sign out', () => {
  test('Super Admin signs in through the real login form', async ({ page, seed, narrate, loginAs }) => {
    await narrate('Sign in as the seeded Super Admin');
    await loginAs(seed.superAdmin.email, seed.superAdmin.password);

    const app = shell(page);
    await expect(app.userMenuButton).toContainText('Super Admin');
    await expect(app.nav.getByRole('link', { name: 'Users', exact: true })).toBeVisible();
    await narrate('Signed in: dashboard with Super Admin navigation');
  });

  test('session survives a hard page reload', async ({ page, seed, narrate, loginAs }) => {
    await loginAs(seed.superAdmin.email, seed.superAdmin.password);
    await narrate('Hard reload - the session must be restored from the refresh cookie');
    await page.reload();

    await expect(page).toHaveURL(/\/dashboard/);
    await expect(shell(page).userMenuButton).toContainText('Super Admin');
  });

  test('wrong password shows an error and stays on /login', async ({ page, seed, narrate }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill(seed.superAdmin.email);
    await page.getByLabel('Password', { exact: true }).fill('definitely-not-the-password');
    await narrate('Submit a wrong password');
    await page.getByRole('button', { name: 'Sign in' }).click();

    const error = page.getByRole('alert').filter({ hasText: 'Invalid email or password.' });
    await expect(error).toBeVisible();
    await highlight(error);
    await expect(page).toHaveURL(/\/login/);
  });

  test('sign out via the user menu returns to /login', async ({ page, seed, narrate, loginAs }) => {
    await loginAs(seed.superAdmin.email, seed.superAdmin.password);
    await narrate('Open the user menu and sign out');
    await shell(page).signOut();

    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  });

  test('forgot-password page offers a "Back to sign in" link', async ({ page, narrate }) => {
    await page.goto('/login');
    await page.getByRole('link', { name: 'Forgot your password?' }).click();
    await expect(page).toHaveURL(/\/forgot-password/);

    const back = page.getByRole('link', { name: 'Back to sign in' });
    await expect(back).toBeVisible();
    await narrate('Forgot-password page has a "Back to sign in" link');
    await highlight(back);
    await back.click();
    await expect(page).toHaveURL(/\/login/);
  });

  test('theme toggle on the login page switches data-theme', async ({ page, narrate }) => {
    await page.goto('/login');
    const app = shell(page);
    await expect(app.themeToggle).toBeVisible();
    const before = await app.theme();
    await narrate(`Toggle theme (currently ${before ?? 'dark'})`);
    await app.toggleTheme();

    await expect.poll(() => app.theme()).not.toBe(before);
    await narrate('Theme switched');
    await app.toggleTheme();
    await expect.poll(() => app.theme()).toBe(before);
  });

  test('protected route redirects to /login when signed out', async ({ page, narrate }) => {
    await narrate('Open /users without a session');
    await page.goto('/users');
    await expect(page).toHaveURL(/\/login/, { timeout: 20_000 });
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  });
});
