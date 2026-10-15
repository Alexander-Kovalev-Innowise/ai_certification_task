import { test, expect, highlight, shell, createTrainer, createCoach } from '../support/test';

/**
 * US-01.13 - Super Admin deletes a user (GDPR): PII anonymised, history kept as "Deleted User",
 * user cannot log in or be reactivated, deletion is logged (original id/email, who, when, why).
 */
test.describe('US-01.13: Super Admin deletes a user (GDPR)', () => {
  test('delete modal needs a reason and the typed word DELETE; Cancel keeps the user', async ({ page, api, mailbox, seed, narrate, loginAs }) => {
    const trainer = await createTrainer(api, mailbox);
    const fullName = `${trainer.firstName} ${trainer.lastName}`;
    await loginAs(seed.superAdmin.email, seed.superAdmin.password);
    await shell(page).goTo('Users');
    await page.getByLabel('Search').fill(trainer.email);
    await page.getByRole('table', { name: 'Users' }).getByRole('row', { name: fullName }).getByRole('link', { name: 'Edit user' }).click();
    await expect(page.getByRole('heading', { name: fullName, level: 2 })).toBeVisible();

    await narrate('Click "Delete user (GDPR)" - a warning modal opens');
    await page.getByRole('button', { name: 'Delete user (GDPR)' }).click();
    const modal = page.getByRole('dialog', { name: 'Delete user (GDPR)' });
    await expect(modal).toBeVisible();
    await expect(modal.getByText("This permanently anonymizes this user's account. This action cannot be undone.")).toBeVisible();
    await highlight(modal);

    const confirm = modal.getByRole('button', { name: 'Permanently delete' });
    await narrate('The destructive button is disabled until BOTH a reason and the word DELETE are given');
    await expect(confirm).toBeDisabled();
    await modal.getByLabel('Reason (for the retention record)').fill('too short');
    await modal.getByLabel('Type DELETE to confirm').fill('delete');
    await modal.getByLabel('Reason (for the retention record)').click();
    await expect(modal.getByText('Please give a bit more detail (at least 10 characters).')).toBeVisible();
    await expect(modal.getByText('Type DELETE in capital letters to confirm.')).toBeVisible();
    await expect(confirm).toBeDisabled();

    await narrate('Valid reason + DELETE in capitals enables the button');
    await modal.getByLabel('Reason (for the retention record)').fill('User requested erasure under GDPR Art. 17 (ticket #4711)');
    await modal.getByLabel('Type DELETE to confirm').fill('DELETE');
    await expect(confirm).toBeEnabled();
    await highlight(confirm);

    await narrate('Cancel: nothing is deleted');
    await modal.getByRole('button', { name: 'Cancel' }).click();
    await expect(modal).toBeHidden();
    await expect(page.getByRole('heading', { name: fullName, level: 2 })).toBeVisible();
    expect((await api.login(trainer.email, trainer.password)).user.email).toBe(trainer.email);
  });

  test('deleting a trainer anonymises the account, blocks login/reactivation and writes the deletion log', async ({
    page,
    api,
    mailbox,
    seed,
    narrate,
    loginAs,
  }) => {
    const trainer = await createTrainer(api, mailbox);
    const admin = await api.superAdmin();
    const fullName = `${trainer.firstName} ${trainer.lastName}`;
    const reason = `GDPR erasure request ${trainer.userId.slice(0, 8)} via support ticket`;

    await loginAs(seed.superAdmin.email, seed.superAdmin.password);
    await shell(page).goTo('Users');
    await page.getByLabel('Search').fill(trainer.email);
    await page.getByRole('table', { name: 'Users' }).getByRole('row', { name: fullName }).getByRole('link', { name: 'Edit user' }).click();
    await expect(page.getByRole('heading', { name: fullName, level: 2 })).toBeVisible();

    await narrate('Delete the user: reason + typed confirmation');
    await page.getByRole('button', { name: 'Delete user (GDPR)' }).click();
    const modal = page.getByRole('dialog', { name: 'Delete user (GDPR)' });
    await modal.getByLabel('Reason (for the retention record)').fill(reason);
    await modal.getByLabel('Type DELETE to confirm').fill('DELETE');
    await modal.getByRole('button', { name: 'Permanently delete' }).click();

    await narrate('The card now shows the anonymised "Deleted User" with status DELETED and no actions left');
    const heading = page.getByRole('heading', { name: 'Deleted User', level: 2 });
    await expect(heading).toBeVisible();
    await highlight(heading);
    const card = heading.locator('xpath=ancestor::form');
    await expect(card.getByText('DELETED', { exact: true }).first()).toBeVisible();
    await expect(card.getByText(`deleted_${trainer.userId}@example.com`)).toBeVisible();
    await expect(page.getByRole('button', { name: /Deactivate user|Reactivate user|Impersonate|Delete user/ })).toHaveCount(0);

    await narrate('The directory lists the row as "Deleted User" / DELETED (record kept, PII gone)');
    await page.getByRole('link', { name: 'Back to users' }).click();
    await page.getByLabel('Search').fill(`deleted_${trainer.userId}`);
    const row = page.getByRole('table', { name: 'Users' }).getByRole('row', { name: 'Deleted User' });
    await expect(row).toBeVisible();
    await expect(row.getByText('DELETED', { exact: true })).toBeVisible();
    await highlight(row);

    await narrate('The original name and email no longer exist anywhere in the directory');
    await page.getByLabel('Search').fill(trainer.email);
    await expect(page.getByText('No users found.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Clear filters' })).toBeVisible();

    await narrate('The deleted trainer cannot sign in with the old credentials');
    await shell(page).signOut();
    await page.getByLabel('Email').fill(trainer.email);
    await page.getByLabel('Password', { exact: true }).fill(trainer.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    const denied = page.getByRole('alert').filter({ hasText: 'Invalid email or password.' });
    await expect(denied).toBeVisible();
    await highlight(denied);
    await expect(page).toHaveURL(/\/login/);

    await narrate('API: stored profile is anonymised, cannot be reactivated, cannot be deleted twice');
    const detail = await api.get<{ firstName: string; lastName: string; email: string; phone: string | null; photoUrl: string | null; status: string }>(
      `/users/${trainer.userId}`,
      { auth: admin },
    );
    expect(detail.status).toBe(200);
    expect(detail.body).toMatchObject({
      firstName: 'Deleted',
      lastName: 'User',
      email: `deleted_${trainer.userId}@example.com`,
      phone: null,
      photoUrl: null,
      status: 'DELETED',
    });
    const reactivate = await api.post<{ errorCode?: string }>(`/users/${trainer.userId}/reactivate`, { auth: admin });
    expect(reactivate.status).toBe(409);
    expect(reactivate.body.errorCode).toBe('CANNOT_REACTIVATE_DELETED_USER');
    const again = await api.delete(`/users/${trainer.userId}`, { auth: admin, body: { reason } });
    expect(again.status).toBe(409);

    await narrate('API: the deletion log records original id + email, who deleted, why and when');
    const log = await api.get<{ items: Array<{ originalUserId: string; originalEmail: string; deletedBy: string; reason: string; deletedAt: string }> }>(
      '/users/deletion-log',
      { auth: admin, query: { limit: 100 } },
    );
    expect(log.status).toBe(200);
    const entry = log.body.items.find((e) => e.originalUserId === trainer.userId);
    expect(entry, 'deletion log entry exists').toBeTruthy();
    expect(entry).toMatchObject({ originalEmail: trainer.email, deletedBy: admin.user.id, reason });
    expect(Date.parse(entry!.deletedAt)).not.toBeNaN();

    await narrate('Only a Super Admin may read the log');
    const forbidden = await api.get('/users/deletion-log', { auth: trainer.session });
    expect([401, 403]).toContain(forbidden.status);
  });

  test('history is preserved: a deleted coach stays on the trainer roster as "Deleted User"', async ({ page, api, mailbox, seed, narrate, loginAs }) => {
    const trainer = await createTrainer(api, mailbox);
    const coach = await createCoach(api, mailbox, trainer);
    const admin = await api.superAdmin();

    await narrate('Super Admin deletes the coach (GDPR) through the UI');
    await loginAs(seed.superAdmin.email, seed.superAdmin.password);
    await shell(page).goTo('Users');
    await page.getByLabel('Search').fill(coach.email);
    await page.getByRole('table', { name: 'Users' }).getByRole('row', { name: `${coach.firstName} ${coach.lastName}` }).getByRole('link', { name: 'Edit user' }).click();
    await page.getByRole('button', { name: 'Delete user (GDPR)' }).click();
    const modal = page.getByRole('dialog', { name: 'Delete user (GDPR)' });
    await modal.getByLabel('Reason (for the retention record)').fill('Coach asked for data erasure (support ticket)');
    await modal.getByLabel('Type DELETE to confirm').fill('DELETE');
    await modal.getByRole('button', { name: 'Permanently delete' }).click();
    await expect(page.getByRole('heading', { name: 'Deleted User', level: 2 })).toBeVisible();

    await narrate('The trainer\'s roster keeps a record - without any personal data');
    const roster = await api.get<{ items: Array<{ name: string | null; email: string; userId: string | null }> }>(`/trainers/${trainer.trainerId}/coaches`, {
      auth: trainer.session,
    });
    const kept = roster.body.items.find((r) => r.userId === coach.userId);
    expect(kept, 'roster row still exists').toBeTruthy();
    expect(JSON.stringify(kept)).not.toContain(coach.email);
    expect(JSON.stringify(kept)).not.toContain(coach.lastName);

    await shell(page).signOut();
    await loginAs(trainer.email, trainer.password);
    await shell(page).goTo('Coaches');
    const table = page.getByRole('table', { name: 'Coach roster' });
    await expect(table.getByRole('row').filter({ hasText: 'Deleted User' }).first()).toBeVisible();
    await expect(table.getByText(coach.email)).toHaveCount(0);
    await highlight(table.getByRole('row').filter({ hasText: 'Deleted User' }).first());
    void admin;
  });
});
