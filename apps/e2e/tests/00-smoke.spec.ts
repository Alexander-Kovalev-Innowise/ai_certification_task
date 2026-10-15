import { test, expect } from '../support/test';

test.describe('Smoke: the isolated e2e stack is up', () => {
  test('API is up and serves its OpenAPI docs', async ({ api, page, narrate }) => {
    expect(await api.isUp()).toBe(true);
    await page.goto(`${api.baseUrl}/docs`);
    await narrate('API (port 3100) is up - Swagger docs served');
    await expect(page).toHaveTitle(/PracticePerfect API|Swagger/i);
  });

  test('client is up and renders the sign-in page', async ({ page, narrate }) => {
    await page.goto('/login');
    await narrate('Client (port 3101) is up - sign-in page');
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
    await expect(page.getByLabel('Email')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
  });

  test('seeded Super Admin can authenticate against the e2e API', async ({ api, seed }) => {
    const session = await api.login(seed.superAdmin.email, seed.superAdmin.password);
    expect(session.user.role).toBe('SUPER_ADMIN');
    expect(session.accessToken).toBeTruthy();
    expect(session.cookie).toContain('refreshToken=');
  });

  test('dev mailbox is available (MAIL_PROVIDER=dev)', async ({ mailbox, page, narrate }) => {
    await page.goto('/login');
    await narrate('Dev mailbox endpoint /__dev/mailbox is reachable');
    expect(await mailbox.isAvailable()).toBe(true);
  });
});
