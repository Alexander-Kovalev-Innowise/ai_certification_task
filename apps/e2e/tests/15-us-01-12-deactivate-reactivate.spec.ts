import { test, expect, highlight, shell, createTrainer, createCoach } from '../support/test';
import type { Page } from '@playwright/test';

/**
 * US-01.12 - Super Admin deactivates (soft-deletes) and reactivates a user.
 * The action lives on the user detail card (Users -> Edit user -> Deactivate user).
 */
test.describe('US-01.12: Super Admin deactivates and reactivates a user', () => {
  async function openUserCard(page: Page, email: string, fullName: string) {
    await shell(page).goTo('Users');
    await page.getByLabel('Search').fill(email);
    await page.getByRole('table', { name: 'Users' }).getByRole('row', { name: fullName }).getByRole('link', { name: 'Edit user' }).click();
    await expect(page.getByRole('heading', { name: fullName, level: 2 })).toBeVisible();
  }

  test('confirmation modal explains the effect; Cancel changes nothing', async ({ page, api, mailbox, seed, narrate, loginAs }) => {
    const trainer = await createTrainer(api, mailbox);
    const fullName = `${trainer.firstName} ${trainer.lastName}`;
    await loginAs(seed.superAdmin.email, seed.superAdmin.password);
    await openUserCard(page, trainer.email, fullName);

    await narrate('The user card shows the account is ACTIVE');
    const card = page.getByRole('heading', { name: fullName, level: 2 }).locator('xpath=ancestor::form');
    await expect(card.getByText('ACTIVE', { exact: true }).first()).toBeVisible();

    await narrate('Click "Deactivate user": the confirmation modal states the consequences');
    await page.getByRole('button', { name: 'Deactivate user' }).click();
    const modal = page.getByRole('dialog', { name: 'Deactivate user' });
    await expect(modal).toBeVisible();
    await expect(modal.getByText('This user will be signed out immediately and unable to log back in until reactivated.')).toBeVisible();
    await highlight(modal);

    await narrate('Cancel: the user stays active');
    await modal.getByRole('button', { name: 'Cancel' }).click();
    await expect(modal).toBeHidden();
    await expect(page.getByRole('button', { name: 'Deactivate user' })).toBeVisible();
    await expect(card.getByText('INACTIVE', { exact: true })).toHaveCount(0);
    const session = await api.login(trainer.email, trainer.password);
    expect(session.user.email).toBe(trainer.email);
  });

  test('deactivate -> Inactive in the directory and filter -> login blocked -> reactivate -> login works again', async ({
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

    await loginAs(seed.superAdmin.email, seed.superAdmin.password);
    await openUserCard(page, trainer.email, fullName);

    await narrate('Confirm the deactivation');
    await page.getByRole('button', { name: 'Deactivate user' }).click();
    await page.getByRole('dialog', { name: 'Deactivate user' }).getByRole('button', { name: 'Deactivate', exact: true }).click();

    await narrate('Status flips to INACTIVE and the action becomes "Reactivate user"');
    const card = page.getByRole('heading', { name: fullName, level: 2 }).locator('xpath=ancestor::form');
    await expect(card.getByText('INACTIVE', { exact: true }).first()).toBeVisible();
    await highlight(card.getByText('INACTIVE', { exact: true }).first());
    await expect(page.getByRole('button', { name: 'Reactivate user' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Deactivate user' })).toHaveCount(0);

    await narrate('The already-issued session is rejected immediately');
    const stale = await api.get('/me', { auth: trainer.session });
    expect(stale.status).toBe(401);

    await narrate('Directory: the user is still listed, now as INACTIVE');
    await page.getByRole('link', { name: 'Back to users' }).click();
    await page.getByLabel('Search').fill(trainer.email);
    const row = page.getByRole('table', { name: 'Users' }).getByRole('row', { name: fullName });
    await expect(row).toBeVisible();
    await expect(row.getByText('INACTIVE', { exact: true })).toBeVisible();
    await highlight(row);

    await narrate('The Status filter "INACTIVE" finds the user, "ACTIVE" does not');
    await page.getByLabel('Status', { exact: true }).selectOption('INACTIVE');
    await expect(row).toBeVisible();
    await page.getByLabel('Status', { exact: true }).selectOption('ACTIVE');
    await expect(row).toHaveCount(0);
    await page.getByLabel('Status', { exact: true }).selectOption('');

    await narrate('Super Admin signs out; the deactivated trainer tries to sign in');
    await app.signOut();
    await page.getByLabel('Email').fill(trainer.email);
    await page.getByLabel('Password', { exact: true }).fill(trainer.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    const blocked = page.getByRole('alert').filter({ hasText: 'Account deactivated. Contact support.' });
    await expect(blocked).toBeVisible();
    await highlight(blocked);
    await expect(page).toHaveURL(/\/login/);

    await narrate('No password-reset mail is sent to a deactivated account either');
    await page.getByRole('link', { name: 'Forgot your password?' }).click();
    await page.getByLabel('Email').fill(trainer.email);
    await mailbox.clear();
    await page.getByRole('button', { name: 'Send reset link' }).click();
    await expect(page.getByRole('status')).toContainText(/If that email exists/i);
    await narrate('Nothing arrives in the inbox');
    expect(await mailbox.list(trainer.email)).toHaveLength(0);

    await narrate('Super Admin signs back in and reactivates the account');
    await loginAs(seed.superAdmin.email, seed.superAdmin.password);
    await openUserCard(page, trainer.email, fullName);
    await page.getByRole('button', { name: 'Reactivate user' }).click();
    const modal = page.getByRole('dialog', { name: 'Reactivate user' });
    await expect(modal.getByText('This user will be able to log in again.')).toBeVisible();
    await modal.getByRole('button', { name: 'Reactivate', exact: true }).click();
    await expect(card.getByText('ACTIVE', { exact: true }).first()).toBeVisible();
    await expect(card.getByText('INACTIVE', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Deactivate user' })).toBeVisible();

    await narrate('The trainer can log in again');
    await app.signOut();
    await loginAs(trainer.email, trainer.password);
    await expect(page.getByRole('heading', { name: `Welcome, ${trainer.firstName}` })).toBeVisible();
  });

  test('deactivation preserves history: the coach stays on the trainer roster', async ({ page, api, mailbox, seed, narrate, loginAs }) => {
    const trainer = await createTrainer(api, mailbox);
    const coach = await createCoach(api, mailbox, trainer);
    const coachName = `${coach.firstName} ${coach.lastName}`;

    await narrate('Super Admin deactivates the coach');
    await loginAs(seed.superAdmin.email, seed.superAdmin.password);
    await openUserCard(page, coach.email, coachName);
    await page.getByRole('button', { name: 'Deactivate user' }).click();
    await page.getByRole('dialog', { name: 'Deactivate user' }).getByRole('button', { name: 'Deactivate', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Reactivate user' })).toBeVisible();

    await narrate('The trainer still sees the coach on their roster (history is preserved)');
    await shell(page).signOut();
    await loginAs(trainer.email, trainer.password);
    await shell(page).goTo('Coaches');
    const row = page.getByRole('table', { name: 'Coach roster' }).getByRole('row').filter({ hasText: coach.email });
    await expect(row).toBeVisible();
    await expect(row).toContainText(coachName);
    await highlight(row);
  });
});
