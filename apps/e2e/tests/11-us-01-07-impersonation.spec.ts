import { test, expect, highlight, shell, createTrainer, createCoach } from '../support/test';

/**
 * US-01.07 - Super Admin impersonates a user.
 * The impersonation entry point lives on the user detail card (Users -> Edit user -> Impersonate).
 */
test.describe('US-01.07: Super Admin impersonates a user', () => {
  test.beforeEach(async ({ seed, loginAs, narrate }) => {
    await narrate('Super Admin signs in');
    await loginAs(seed.superAdmin.email, seed.superAdmin.password);
  });

  test('impersonates a trainer from the user detail card: banner, trainer view, exit back to admin', async ({
    page,
    api,
    mailbox,
    narrate,
  }) => {
    const trainer = await createTrainer(api, mailbox);
    const fullName = `${trainer.firstName} ${trainer.lastName}`;
    const app = shell(page);

    await narrate('Users -> find the trainer -> open the user card');
    await app.goTo('Users');
    await page.getByLabel('Search').fill(trainer.email);
    const row = page.getByRole('table', { name: 'Users' }).getByRole('row', { name: fullName });
    await expect(row).toBeVisible();
    await row.getByRole('link', { name: 'Edit user' }).click();
    await expect(page.getByRole('heading', { name: fullName })).toBeVisible();

    await narrate('Click "Impersonate" - a confirmation modal names the user');
    await page.getByRole('button', { name: 'Impersonate', exact: true }).click();
    const modal = page.getByRole('dialog', { name: `Impersonate ${fullName}?` });
    await expect(modal).toBeVisible();
    await expect(modal.getByText(/up to 60 minutes/)).toBeVisible();
    await highlight(modal);

    await narrate('Confirm - the portal switches to the trainer\'s view');
    await modal.getByRole('button', { name: 'Impersonate', exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard/);

    const banner = page.getByTestId('impersonation-banner');
    await expect(banner).toContainText(`Viewing as ${fullName} (TRAINER)`);
    await highlight(banner);
    await expect(banner.getByRole('button', { name: 'Exit Impersonation' })).toBeVisible();

    await narrate('The banner is sticky and shows a countdown (session capped at 60 minutes)');
    expect(await banner.evaluate((el) => getComputedStyle(el).position)).toBe('sticky');
    const countdown = (await page.getByTestId('impersonation-countdown').textContent()) ?? '';
    expect(countdown).toMatch(/^\d{1,2}:\d{2}$/);
    expect(Number(countdown.split(':')[0])).toBeLessThanOrEqual(60);

    await narrate('Navigation and data match the trainer exactly - trainer nav, no admin tools');
    await expect(page.getByRole('heading', { name: `Welcome, ${trainer.firstName}` })).toBeVisible();
    await expect(app.nav.getByRole('link', { name: 'Coaches', exact: true })).toBeVisible();
    await expect(app.nav.getByRole('link', { name: 'Branding', exact: true })).toBeVisible();
    await expect(app.nav.getByRole('link', { name: 'Users', exact: true })).toHaveCount(0);
    await expect(app.userMenuButton).toContainText(fullName);

    await narrate('The banner stays on screen while navigating (and sign-out is hidden while impersonating)');
    await app.goTo('Coaches');
    await expect(page.getByRole('heading', { name: 'Coaches', level: 1 })).toBeVisible();
    await expect(banner).toBeVisible();
    await app.openUserMenu();
    await expect(page.getByRole('menuitem', { name: 'Sign out' })).toHaveCount(0);
    await page.keyboard.press('Escape');

    await narrate('Exit Impersonation returns to the Super Admin view');
    await banner.getByRole('button', { name: 'Exit Impersonation' }).click();
    await expect(banner).toBeHidden({ timeout: 15_000 });
    await expect(app.userMenuButton).toContainText('Super Admin');
    await expect(app.nav.getByRole('link', { name: 'Users', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: /Welcome, Super/ })).toBeVisible();
  });

  test('impersonating a coach shows the coach view (My Times / Profile) and the audit history lists the session', async ({
    page,
    api,
    mailbox,
    narrate,
  }) => {
    const trainer = await createTrainer(api, mailbox);
    const coach = await createCoach(api, mailbox, trainer);
    const coachName = `${coach.firstName} ${coach.lastName}`;
    const app = shell(page);

    await narrate('Open the coach\'s user card and impersonate');
    await app.goTo('Users');
    await page.getByLabel('Search').fill(coach.email);
    await page.getByRole('table', { name: 'Users' }).getByRole('row', { name: coachName }).getByRole('link', { name: 'Edit user' }).click();
    await page.getByRole('button', { name: 'Impersonate', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Impersonate', exact: true }).click();

    const banner = page.getByTestId('impersonation-banner');
    await expect(banner).toContainText(`Viewing as ${coachName} (COACH)`);
    await expect(app.nav.getByRole('link', { name: 'My Times', exact: true })).toBeVisible();
    await expect(app.nav.getByRole('link', { name: 'Profile', exact: true })).toBeVisible();
    await expect(app.nav.getByRole('link', { name: 'Coaches', exact: true })).toHaveCount(0);
    await narrate('The coach\'s own pages work under impersonation');
    await app.goTo('My Times');
    await expect(page.getByRole('heading', { name: 'My Times', level: 1 })).toBeVisible();

    await narrate('Exit the session');
    await banner.getByRole('button', { name: 'Exit Impersonation' }).click();
    await expect(banner).toBeHidden({ timeout: 15_000 });

    await narrate('Impersonation History lists the finished session (admin, target, start, end, duration)');
    await app.goTo('Impersonation History');
    await expect(page.getByRole('heading', { name: 'Impersonation History', level: 1 })).toBeVisible();
    const historyRow = page
      .getByRole('table', { name: 'Impersonation history' })
      .getByRole('row')
      .filter({ hasText: `${coachName} (COACH)` })
      .first();
    await expect(historyRow).toBeVisible();
    await expect(historyRow).toContainText('Super Admin');
    await expect(historyRow).not.toContainText('In progress');
    await expect(historyRow).toContainText(/\d+m \d+s/);
    await highlight(historyRow);
  });

  test('a Super Admin cannot be impersonated: no button in the UI and the API refuses (422)', async ({ page, api, seed, narrate }) => {
    const admin = await api.superAdmin();
    const app = shell(page);

    await narrate('Open the Super Admin\'s own user card');
    await app.goTo('Users');
    await page.getByLabel('Search').fill(seed.superAdmin.email);
    await page.getByRole('table', { name: 'Users' }).getByRole('row', { name: 'Super Admin' }).getByRole('link', { name: 'Edit user' }).click();
    await expect(page.getByRole('heading', { name: 'Super Admin', level: 2 })).toBeVisible();

    await narrate('There is no "Impersonate" action for a Super Admin');
    await expect(page.getByRole('button', { name: 'Deactivate user' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Impersonate', exact: true })).toHaveCount(0);

    await narrate('The API enforces the same rule: POST /impersonation/start -> 422');
    const res = await api.post<{ errorCode?: string }>('/impersonation/start', { auth: admin, body: { targetUserId: admin.user.id } });
    expect(res.status).toBe(422);
    expect(res.body.errorCode).toBe('IMPERSONATION_TARGET_INVALID');
  });

  test('only a Super Admin can start impersonation (trainer is forbidden)', async ({ page, api, mailbox, narrate }) => {
    const trainer = await createTrainer(api, mailbox);
    const coach = await createCoach(api, mailbox, trainer);

    await narrate('A trainer calling POST /impersonation/start is refused (403)');
    await page.goto('/login');
    const res = await api.post('/impersonation/start', { auth: trainer.session, body: { targetUserId: coach.userId } });
    expect(res.status).toBe(403);
    const history = await api.get('/impersonation/history', { auth: trainer.session });
    expect(history.status).toBe(403);
  });
});
