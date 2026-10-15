import { test, expect, highlight, shell, uniqueEmail, uniqueName, createTrainer, showEmail, validPhone, strongPassword } from '../support/test';

/**
 * US-01.01 - Super Admin creates a trainer account.
 * Acceptance criteria covered: modal from Users tool, required fields + phone validation,
 * duplicate email error, invite email with setup link, trainer sets up + logs in to the
 * trainer dashboard, new trainer listed as ACTIVE.
 *
 * Note: the app has no "temporary password" - the trainer receives a one-time setup link and
 * chooses their own password (the story allows "temporary password OR invite email"). Completing
 * the setup clears mustChangePassword, so there is no extra forced-change screen afterwards.
 */
test.describe('US-01.01: Super Admin creates a trainer account', () => {
  test.beforeEach(async ({ seed, loginAs, page, narrate }) => {
    await narrate('Super Admin signs in');
    await loginAs(seed.superAdmin.email, seed.superAdmin.password);
    await shell(page).goTo('Users');
    await expect(page.getByRole('heading', { name: 'Users', level: 1 })).toBeVisible();
  });

  test('Create Trainer modal enforces required fields and email/phone validation', async ({ page, narrate }) => {
    await narrate('Users tool -> "Create Trainer" opens the creation modal');
    await page.getByRole('button', { name: 'Create Trainer' }).click();
    const dialog = page.getByRole('dialog', { name: 'Create Trainer' });
    await expect(dialog).toBeVisible();

    await narrate('Submitting an empty form shows every required-field error');
    await dialog.getByRole('button', { name: 'Create trainer' }).click();
    for (const message of ['Business name is required.', 'First name is required.', 'Last name is required.', 'Email is required.', 'Phone number is required.']) {
      await expect(dialog.getByText(message)).toBeVisible();
    }
    await highlight(dialog.getByText('Business name is required.'));

    await narrate('A malformed email is rejected');
    await dialog.getByLabel('Email').fill('not-an-email');
    await dialog.getByLabel('Business name').click();
    const emailError = dialog.getByText('Enter a valid email address, e.g. name@example.com.');
    await expect(emailError).toBeVisible();
    await highlight(emailError);

    await narrate('A phone number that is not valid for the country is rejected');
    await dialog.getByLabel('Phone').fill('123');
    await dialog.getByLabel('Business name').click();
    const phoneError = dialog.getByText('Enter a valid phone number for the selected country.');
    await expect(phoneError).toBeVisible();
    await highlight(phoneError);

    await narrate('A name with digits is rejected too');
    await dialog.getByLabel('First name').fill('J0hn');
    await dialog.getByLabel('Business name').click();
    await expect(dialog.getByText('First name can only contain letters, spaces, hyphens and apostrophes.')).toBeVisible();

    await narrate('Cancel closes the modal without creating anything');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
  });

  test('duplicate email shows a clear error and nothing is created', async ({ page, api, mailbox, narrate }) => {
    const existing = await createTrainer(api, mailbox);
    const { firstName, lastName } = uniqueName('Dup');

    await narrate(`A trainer with ${existing.email} already exists`);
    await page.getByRole('button', { name: 'Create Trainer' }).click();
    const dialog = page.getByRole('dialog', { name: 'Create Trainer' });
    await dialog.getByLabel('Business name').fill('Duplicate Academy');
    await dialog.getByLabel('First name').fill(firstName);
    await dialog.getByLabel('Last name').fill(lastName);
    await dialog.getByLabel('Email').fill(existing.email);
    await dialog.getByLabel('Phone').fill('4155552671');

    await narrate('Submit with the already-used email');
    await dialog.getByRole('button', { name: 'Create trainer' }).click();

    const error = dialog.getByRole('alert').filter({ hasText: 'A user with this email already exists.' });
    await expect(error).toBeVisible();
    await highlight(error);
    await expect(dialog).toBeVisible();

    await narrate('The modal stays open so the email can be corrected');
    await dialog.getByLabel('Email').fill(uniqueEmail('corrected'));
    await dialog.getByRole('button', { name: 'Cancel' }).click();
  });

  test('creates a trainer, invite email arrives, trainer completes setup and reaches the trainer dashboard', async ({
    page,
    mailbox,
    seed,
    narrate,
    loginAs,
  }) => {
    const email = uniqueEmail('newtrainer');
    const { firstName, lastName } = uniqueName('Nova');
    const businessName = `${lastName} Basketball Academy`;
    const password = strongPassword();

    await narrate('Click "Create Trainer" and fill in business, name, email and phone');
    await page.getByRole('button', { name: 'Create Trainer' }).click();
    const dialog = page.getByRole('dialog', { name: 'Create Trainer' });
    await dialog.getByLabel('Business name').fill(businessName);
    await dialog.getByLabel('First name').fill(firstName);
    await dialog.getByLabel('Last name').fill(lastName);
    await dialog.getByLabel('Email').fill(email);
    await dialog.getByLabel('Phone').fill(validPhone().replace('+1', ''));
    await highlight(dialog);
    await dialog.getByRole('button', { name: 'Create trainer' }).click();
    await expect(dialog).toBeHidden();

    await narrate('The new trainer is listed in the directory with status ACTIVE');
    await page.getByLabel('Search').fill(email);
    const row = page.getByRole('table', { name: 'Users' }).getByRole('row', { name: `${firstName} ${lastName}` });
    await expect(row).toBeVisible();
    await expect(row.getByText('ACTIVE', { exact: true })).toBeVisible();
    await expect(row.getByText('TRAINER', { exact: true })).toBeVisible();
    await expect(row.getByText(email)).toBeVisible();
    await highlight(row);

    await narrate('The invitation email lands in the trainer\'s inbox with a setup link');
    const mail = await mailbox.waitFor(email, { subject: /complete your trainer account setup/i });
    expect(mail.links.some((l) => /\/register\?token=/.test(l))).toBe(true);
    const setupLink = await mailbox.linkTo(email, /register\?token=/);
    expect(mail.html).toContain('Set up your account');
    expect(mail.text.length).toBeGreaterThan(0);

    await narrate('Super Admin signs out');
    await shell(page).signOut();
    await expect(page).toHaveURL(/\/login/);

    await showEmail(page, mail);
    await narrate('Trainer clicks the setup link in the email');
    await page.goto(setupLink);
    await expect(page.getByRole('heading', { name: 'Complete your account' })).toBeVisible();

    await narrate('A weak password is rejected by the password policy');
    await page.getByLabel('Choose a password').fill('short');
    await page.getByRole('button', { name: 'Complete setup' }).click();
    await expect(page.getByText('Password must be at least 8 characters.')).toBeVisible();

    await narrate('Trainer chooses a strong password and completes setup');
    await page.getByLabel('Choose a password').fill(password);
    await page.getByRole('button', { name: 'Complete setup' }).click();

    await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 });
    const welcome = page.getByRole('heading', { name: `Welcome, ${firstName}` });
    await expect(welcome).toBeVisible();
    await highlight(welcome);
    await expect(shell(page).nav.getByRole('link', { name: 'Coaches', exact: true })).toBeVisible();
    await expect(shell(page).nav.getByRole('link', { name: 'Branding', exact: true })).toBeVisible();
    await expect(page.getByText(businessName).first()).toBeVisible();
    await narrate('Trainer dashboard: business name, trainer navigation, no admin tools');
    await expect(shell(page).nav.getByRole('link', { name: 'Users', exact: true })).toHaveCount(0);

    await narrate('The trainer can sign out and sign in again with the new password');
    await shell(page).signOut();
    await expect(page).toHaveURL(/\/login/);
    await loginAs(email, password);
    await expect(shell(page).userMenuButton).toContainText(firstName);
    void seed;
  });

  test('a used or bogus setup link is rejected', async ({ page, api, mailbox, narrate }) => {
    const trainer = await createTrainer(api, mailbox);

    await narrate('The one-time setup link was already used - opening it again is refused');
    await page.goto(trainer.setupLink);
    await page.getByLabel('Choose a password').fill(strongPassword());
    await page.getByRole('button', { name: 'Complete setup' }).click();
    const used = page.getByRole('alert').filter({ hasText: 'This link is invalid or has expired.' });
    await expect(used).toBeVisible();
    await highlight(used);

    await narrate('A made-up setup token shows "invalid or expired"');
    await page.goto('/register?token=this-is-not-a-real-token');
    await page.getByLabel('Choose a password').fill(strongPassword());
    await page.getByRole('button', { name: 'Complete setup' }).click();
    const bogus = page.getByRole('alert').filter({ hasText: 'This link is invalid or has expired.' });
    await expect(bogus).toBeVisible();
    await highlight(bogus);

    await narrate('No token at all is rejected immediately');
    await page.goto('/register');
    await expect(page.getByRole('alert').filter({ hasText: 'This link is invalid or has expired.' })).toBeVisible();
  });
});
