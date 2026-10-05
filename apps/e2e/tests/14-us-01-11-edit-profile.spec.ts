import { test, expect, highlight, shell, createTrainer, createCoach, makePng, makeSvg } from '../support/test';

/**
 * US-01.11 - A user edits their own profile (trainer, coach, super admin in this batch).
 * Editable: first/last name, phone, photo, notification prefs (+ business details for trainers,
 * bio/credentials/certifications/public profile for coaches). Email and role are NOT editable.
 *
 * Gap (reported): the Account page shows the creation date but does not display the read-only email / role;
 * "School / jersey number" belong to player profiles (other batch).
 */
test.describe('US-01.11: User edits own profile', () => {
  test('trainer edits name and phone; email/role are not editable; validation messages', async ({ page, api, mailbox, narrate, loginAs }) => {
    const trainer = await createTrainer(api, mailbox);
    const app = shell(page);

    await narrate('Trainer signs in and opens Account');
    await loginAs(trainer.email, trainer.password);
    await app.goTo('Account');
    await expect(page.getByRole('heading', { name: 'Account', level: 1 })).toBeVisible();
    await expect(page.getByText('Account created:')).toBeVisible();

    await narrate('Fields are pre-filled with the current values');
    await expect(page.getByLabel('First name')).toHaveValue(trainer.firstName);
    await expect(page.getByLabel('Last name')).toHaveValue(trainer.lastName);

    await narrate('Email and role are not editable fields on this form');
    await expect(page.getByLabel('Email', { exact: true })).toHaveCount(0);
    await expect(page.getByLabel('Role', { exact: true })).toHaveCount(0);
    const forbiddenEmail = await api.request('PATCH', '/me', { auth: trainer.session, body: { email: 'hacker@e2e.test' } });
    expect(forbiddenEmail.status).toBe(400);
    const forbiddenRole = await api.request('PATCH', '/me', { auth: trainer.session, body: { role: 'SUPER_ADMIN' } });
    expect(forbiddenRole.status).toBe(400);

    await narrate('Required fields and phone format are validated');
    await page.getByLabel('First name').fill('');
    await page.getByLabel('Last name').fill('Smith9');
    await page.getByLabel('Phone').fill('12');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('First name is required.')).toBeVisible();
    await expect(page.getByText('Last name can only contain letters, spaces, hyphens and apostrophes.')).toBeVisible();
    await expect(page.getByText('Enter a valid phone number for the selected country.')).toBeVisible();
    await highlight(page.getByText('Enter a valid phone number for the selected country.'));

    await narrate('Fix the values and save');
    const newFirst = 'Jordan';
    const newLast = `${trainer.lastName}-Lee`;
    await page.getByLabel('First name').fill(newFirst);
    await page.getByLabel('Last name').fill(newLast);
    await page.getByLabel('Phone').fill('2025550143');
    await page.getByLabel('SMS notifications').check();
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    const saved = page.getByRole('status').filter({ hasText: 'Profile saved.' });
    await expect(saved).toBeVisible();
    await highlight(saved);

    await narrate('The user pill updates immediately, and the change is persisted after a reload');
    await expect(app.userMenuButton).toContainText(`${newFirst} ${newLast}`);
    await page.reload();
    await expect(app.userMenuButton).toContainText(`${newFirst} ${newLast}`);
    await expect(page.getByLabel('First name')).toHaveValue(newFirst);
    await expect(page.getByLabel('SMS notifications')).toBeChecked();
    const me = await api.get<{ firstName: string; lastName: string; phone: string; email: string; role: string }>('/me', { auth: trainer.session });
    expect(me.body).toMatchObject({ firstName: newFirst, lastName: newLast, phone: '+12025550143', email: trainer.email, role: 'TRAINER' });
  });

  test('profile photo: PNG upload shows an avatar in the user pill; bad type and oversize files are rejected', async ({ page, api, mailbox, narrate, loginAs }) => {
    const trainer = await createTrainer(api, mailbox);
    const app = shell(page);
    await loginAs(trainer.email, trainer.password);
    await app.goTo('Account');
    const fileInput = page.getByLabel('Photo', { exact: true });

    await narrate('Initials are shown until a photo is uploaded');
    await expect(app.userMenuButton.locator('img')).toHaveCount(0);

    await narrate('A text file is rejected (type check)');
    await fileInput.setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('not an image') });
    const typeError = page.getByRole('alert').filter({ hasText: 'Unsupported file type. Use PNG, JPEG, WebP or SVG.' });
    await expect(typeError).toBeVisible();
    await highlight(typeError);

    await narrate('A file over 2MB is rejected (size check)');
    await fileInput.setInputFiles({ name: 'huge.png', mimeType: 'image/png', buffer: Buffer.alloc(2 * 1024 * 1024 + 1024, 1) });
    const sizeError = page.getByRole('alert').filter({ hasText: 'The image is larger than 2MB. Choose a smaller file.' });
    await expect(sizeError).toBeVisible();
    await highlight(sizeError);

    await narrate('Upload a small PNG');
    await fileInput.setInputFiles({ name: 'me.png', mimeType: 'image/png', buffer: makePng([220, 30, 90], 96) });
    const preview = page.getByAltText('Photo preview');
    await expect(preview).toBeVisible();
    await expect(page.getByRole('button', { name: 'Change photo' })).toBeVisible();
    await highlight(preview);

    await narrate('Save - the avatar appears in the user pill');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Profile saved.' })).toBeVisible();
    const avatar = app.userMenuButton.locator('img');
    await expect(avatar).toBeVisible();
    await expect.poll(() => avatar.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
    await highlight(app.userMenuButton);

    await narrate('The avatar survives a reload (stored in file storage, URL saved on the profile)');
    await page.reload();
    await expect(app.userMenuButton.locator('img')).toBeVisible();
    const me = await api.get<{ photoUrl: string | null }>('/me', { auth: trainer.session });
    expect(me.body.photoUrl).toMatch(/\/uploads\/photo-/);

    await narrate('Remove the photo and save: back to initials');
    await page.getByRole('button', { name: 'Remove photo' }).click();
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Profile saved.' })).toBeVisible();
    await expect(app.userMenuButton.locator('img')).toHaveCount(0);
  });

  test('trainer edits business details (name, address, website, description) with validation', async ({ page, api, mailbox, narrate, loginAs }) => {
    const trainer = await createTrainer(api, mailbox);
    const app = shell(page);
    await loginAs(trainer.email, trainer.password);
    await app.goTo('Account');

    const section = page.getByRole('heading', { name: 'Business', level: 2 });
    await narrate('Trainers get an extra "Business" section on their account page');
    await expect(section).toBeVisible();
    await expect(page.getByLabel('Business name')).toHaveValue(trainer.businessName);

    await narrate('Business name is required; the website must be a full address');
    await page.getByLabel('Business name').fill('');
    await page.getByLabel('Website').fill('http://x');
    await page.getByRole('button', { name: 'Save business details' }).click();
    await expect(page.getByText('Business name is required.')).toBeVisible();
    await expect(page.getByText('Enter a full website address, e.g. https://example.com.')).toBeVisible();
    await highlight(page.getByText('Enter a full website address, e.g. https://example.com.'));

    await narrate('Fill in the business details and save');
    const newName = `${trainer.lastName} Elite Basketball`;
    await page.getByLabel('Business name').fill(newName);
    await page.getByLabel('Address').fill('123 Main St, Springfield');
    await page.getByLabel('Website').fill('https://www.elite-basketball.example.com');
    await page.getByLabel('Description').fill('Skills training for ages 8-18.');
    await page.getByRole('button', { name: 'Save business details' }).click();
    const toast = page.getByRole('status').filter({ hasText: 'Business details saved.' });
    await expect(toast).toBeVisible();
    await highlight(toast);

    await narrate('The new business name shows on the trainer dashboard');
    await app.goTo('Dashboard');
    await expect(page.getByText(newName).first()).toBeVisible();
    await app.goTo('Account');
    await expect(page.getByLabel('Address')).toHaveValue('123 Main St, Springfield');
    await expect(page.getByLabel('Description')).toHaveValue('Skills training for ages 8-18.');
  });

  test('coach edits bio, credentials, certifications and the public-profile flag', async ({ page, api, mailbox, narrate, loginAs }) => {
    const trainer = await createTrainer(api, mailbox);
    const coach = await createCoach(api, mailbox, trainer);
    const app = shell(page);

    await narrate('Coach signs in and opens Profile');
    await loginAs(coach.email, coach.password);
    await app.goTo('Profile');
    await expect(page.getByRole('heading', { name: 'Profile', level: 1 })).toBeVisible();

    await narrate('Bio, credentials and certifications (coach-specific fields)');
    await page.getByLabel('Bio').fill('Former college point guard, 10 years coaching youth basketball.');
    await page.getByLabel('Credentials').fill('B.Sc. Sports Science');
    await page.getByLabel('Certifications').fill('USA Basketball Coach License, First Aid & CPR');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    const saved = page.getByRole('status').filter({ hasText: 'Profile saved.' });
    await expect(saved).toBeVisible();
    await highlight(saved);

    await narrate('Toggle the "Public profile" checkbox');
    const publicToggle = page.getByLabel('Public profile');
    await expect(publicToggle).not.toBeChecked();
    await publicToggle.check();
    await expect(publicToggle).toBeChecked();

    await narrate('Everything persists after a reload');
    await page.reload();
    await expect(page.getByLabel('Bio')).toHaveValue('Former college point guard, 10 years coaching youth basketball.');
    await expect(page.getByLabel('Credentials')).toHaveValue('B.Sc. Sports Science');
    await expect(page.getByLabel('Certifications')).toHaveValue('USA Basketball Coach License, First Aid & CPR');
    await expect(page.getByLabel('Public profile')).toBeChecked();
    await highlight(page.getByLabel('Public profile'));

    await narrate('A coach also has the shared Account page (name, phone, photo)');
    await app.goTo('Account');
    await expect(page.getByLabel('First name')).toHaveValue(coach.firstName);
    await page.getByLabel('Phone').fill('2025550177');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Profile saved.' })).toBeVisible();
  });

  test('super admin edits own phone and notification preferences; no trainer business section', async ({ page, api, seed, narrate, loginAs }) => {
    const app = shell(page);
    await narrate('Super Admin signs in and opens Account');
    await loginAs(seed.superAdmin.email, seed.superAdmin.password);
    await app.goTo('Account');
    await expect(page.getByRole('heading', { name: 'Account', level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Business', level: 2 })).toHaveCount(0);

    await narrate('Edit the phone number and switch off email notifications');
    await page.getByLabel('Phone').fill('2025550111');
    await page.getByLabel('Email notifications').uncheck();
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    const saved = page.getByRole('status').filter({ hasText: 'Profile saved.' });
    await expect(saved).toBeVisible();
    await highlight(saved);

    await narrate('Reload: the phone is persisted');
    await page.reload();
    await expect(page.getByLabel('First name')).toHaveValue('Super');
    const me = await api.get<{ phone: string }>('/me', { auth: await api.superAdmin() });
    expect(me.body.phone).toBe('+12025550111');

    await narrate('Restore the notification preference');
    await page.getByLabel('Email notifications').check();
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Profile saved.' })).toBeVisible();
    void makeSvg;
  });
});
