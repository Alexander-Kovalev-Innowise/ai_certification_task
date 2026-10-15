import {
  test,
  expect,
  highlight,
  shell,
  createTrainer,
  createCoach,
  showEmail,
  expireShareLink,
  strongPassword,
  uniqueEmail,
  uniqueName,
} from '../support/test';

/**
 * US-01.08 - Trainer invites a coach.
 * Invite modal -> unique single-use 7-day link by email -> coach accepts (name + password) -> roster shows
 * Pending / Accepted / Expired; resend revokes the old link; a coach active under another trainer is rejected.
 */
test.describe('US-01.08: Trainer invites a coach', () => {
  const rosterRow = (page: import('@playwright/test').Page, text: string) =>
    page.getByRole('table', { name: 'Coach roster' }).getByRole('row').filter({ hasText: text });

  test('invite modal validates input, sends the invite and the roster shows it as Pending', async ({ page, api, mailbox, narrate, loginAs }) => {
    const trainer = await createTrainer(api, mailbox);
    const coachEmail = uniqueEmail('invitee');
    const message = 'We would love to have you on the team this season!';

    await narrate('Trainer signs in and opens the Coaches section');
    await loginAs(trainer.email, trainer.password);
    await shell(page).goTo('Coaches');
    await expect(page.getByRole('heading', { name: 'Coaches', level: 1 })).toBeVisible();
    await expect(page.getByText('No coaches yet')).toBeVisible();

    await narrate('Click "Invite Coach"');
    await page.getByRole('button', { name: 'Invite Coach' }).click();
    const dialog = page.getByRole('dialog', { name: 'Invite a coach' });
    await expect(dialog).toBeVisible();

    await narrate('Email is required and must be well formed');
    await dialog.getByRole('button', { name: 'Send invite' }).click();
    await expect(dialog.getByText('Email is required.')).toBeVisible();
    await dialog.getByLabel('Email').fill('not-an-email');
    await dialog.getByLabel('Message (optional)').click();
    await expect(dialog.getByText('Enter a valid email address, e.g. name@example.com.')).toBeVisible();

    await narrate('Enter the coach email, optional name and message, and send');
    await dialog.getByLabel('Email').fill(coachEmail);
    await dialog.getByLabel('Name (optional)').fill('Casey Morgan');
    await dialog.getByLabel('Message (optional)').fill(message);
    await highlight(dialog);
    await dialog.getByRole('button', { name: 'Send invite' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText('Invite sent.')).toBeVisible();

    await narrate('The roster lists the invitation as Pending with its 7-day expiry');
    const row = rosterRow(page, coachEmail);
    await expect(row).toBeVisible();
    await expect(row.getByText('Pending', { exact: true })).toBeVisible();
    await expect(row.getByText(/^Expires /)).toBeVisible();
    await expect(row.getByRole('button', { name: 'Resend invite' })).toBeVisible();
    await highlight(row);

    await narrate('The coach receives the invitation email with the trainer\'s message and a link');
    const mail = await mailbox.waitFor(coachEmail, { subject: /invited you to coach/i });
    expect(mail.subject).toContain(trainer.businessName);
    expect(mail.text + mail.html).toContain(message);
    expect(mail.links.some((l) => /\/join\/[^/?#]+/.test(l))).toBe(true);
    await shell(page).signOut();
    await showEmail(page, mail);
  });

  test('coach follows the link, registers with name and password and appears as Accepted on the roster', async ({
    page,
    api,
    mailbox,
    narrate,
    loginAs,
  }) => {
    const trainer = await createTrainer(api, mailbox);
    const coachEmail = uniqueEmail('coachnew');
    const { firstName, lastName } = uniqueName('Casey');
    const password = strongPassword();
    const invite = await api.post('/coaches/invite', { auth: trainer.session, body: { email: coachEmail } });
    expect(invite.status).toBe(201);
    const link = await mailbox.linkTo(coachEmail, /\/join\//);

    await narrate('Coach opens the unique invitation link from the email');
    await page.goto(link);
    await expect(page.getByRole('heading', { name: `Join ${trainer.businessName}` })).toBeVisible();
    await highlight(page.getByRole('heading', { name: `Join ${trainer.businessName}` }));

    await narrate('First name, last name and a password are required');
    await page.getByRole('button', { name: 'Accept invitation' }).click();
    await expect(page.getByText('First name is required.')).toBeVisible();
    await expect(page.getByText('Last name is required.')).toBeVisible();

    await narrate('Coach fills in the registration form');
    await page.getByLabel('First name').fill(firstName);
    await page.getByLabel('Last name').fill(lastName);
    await page.getByLabel('Choose a password').fill('weak');
    await page.getByRole('button', { name: 'Accept invitation' }).click();
    await expect(page.getByText('Password must be at least 8 characters.')).toBeVisible();
    await page.getByLabel('Choose a password').fill(password);
    await page.getByRole('button', { name: 'Accept invitation' }).click();

    await expect(page.getByRole('status').filter({ hasText: `Welcome, ${firstName}!` })).toBeVisible();
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 });
    await narrate('Coach lands on the coach dashboard under this trainer');
    await expect(page.getByRole('heading', { name: `Welcome, ${firstName}` })).toBeVisible();
    await expect(page.getByText(trainer.businessName).first()).toBeVisible();
    await expect(shell(page).nav.getByRole('link', { name: 'My Times', exact: true })).toBeVisible();

    await narrate('The one-time link cannot be used again');
    await shell(page).signOut();
    await page.goto(link);
    // A claimed single-use link is flipped to EXPIRED server-side, so the join page says so.
    await expect(page.getByRole('alert').filter({ hasText: /This invitation link has (expired|already been used)/ })).toBeVisible();

    await narrate('Trainer signs in: the coach is listed as Accepted');
    await loginAs(trainer.email, trainer.password);
    await shell(page).goTo('Coaches');
    const row = rosterRow(page, `${firstName} ${lastName}`);
    await expect(row).toBeVisible();
    await expect(row.getByText('Accepted', { exact: true })).toBeVisible();
    await expect(row.getByText(coachEmail)).toBeVisible();
    await highlight(row);
    await expect(row.getByRole('button', { name: 'Resend invite' })).toHaveCount(0);
  });

  test('resend revokes the old link and issues a new one; an expired invite shows Expired and can be resent', async ({
    page,
    api,
    mailbox,
    narrate,
    loginAs,
  }) => {
    const trainer = await createTrainer(api, mailbox);
    const coachEmail = uniqueEmail('resend');
    const invite = await api.post<{ shareLinkCode: string }>('/coaches/invite', { auth: trainer.session, body: { email: coachEmail } });
    expect(invite.status).toBe(201);
    const oldLink = await mailbox.linkTo(coachEmail, /\/join\//);
    const oldCode = invite.body.shareLinkCode;

    await narrate('Trainer sees the pending invite and clicks "Resend invite"');
    await loginAs(trainer.email, trainer.password);
    await shell(page).goTo('Coaches');
    const row = rosterRow(page, coachEmail);
    await expect(row.getByText('Pending', { exact: true })).toBeVisible();
    await row.getByRole('button', { name: 'Resend invite' }).click();
    await expect(page.getByText(`Invite resent to ${coachEmail}. The previous link no longer works.`)).toBeVisible();

    await narrate('A second email arrives with a NEW link');
    await expect.poll(async () => (await mailbox.list(coachEmail)).length, { timeout: 15_000 }).toBeGreaterThanOrEqual(2);
    const newLink = await mailbox.linkTo(coachEmail, /\/join\//);
    expect(newLink).not.toBe(oldLink);
    await expect(rosterRow(page, coachEmail)).toHaveCount(1); // never a duplicate roster row

    await narrate('The previous link is revoked');
    await page.goto(oldLink);
    await expect(page.getByRole('alert').filter({ hasText: 'This invitation link is no longer active.' })).toBeVisible();
    await narrate('The new link is valid');
    await page.goto(newLink);
    await expect(page.getByRole('heading', { name: `Join ${trainer.businessName}` })).toBeVisible();

    await narrate('Simulate the 7-day expiry of the invitation');
    const newCode = decodeURIComponent(new URL(newLink).pathname.split('/').pop() ?? '');
    expect(newCode).not.toBe(oldCode);
    await expireShareLink(newCode);
    await page.goto(newLink);
    const expired = page.getByRole('alert').filter({ hasText: 'This invitation link has expired. Ask your trainer for a new one.' });
    await expect(expired).toBeVisible();
    await highlight(expired);

    await narrate('The roster now shows the invite as Expired, with a resend action');
    await page.goto('/login');
    await loginAs(trainer.email, trainer.password);
    await shell(page).goTo('Coaches');
    const expiredRow = rosterRow(page, coachEmail);
    await expect(expiredRow.getByText('Expired', { exact: true })).toBeVisible();
    await highlight(expiredRow);
    await narrate('Resend an expired invitation');
    await expiredRow.getByRole('button', { name: 'Resend invite' }).click();
    await expect(rosterRow(page, coachEmail).getByText('Pending', { exact: true })).toBeVisible();
    await expect(rosterRow(page, coachEmail)).toHaveCount(1);
  });

  test('a coach that is already active under another trainer cannot be invited', async ({ page, api, mailbox, narrate, loginAs }) => {
    const trainerA = await createTrainer(api, mailbox);
    const coach = await createCoach(api, mailbox, trainerA);
    const trainerB = await createTrainer(api, mailbox);

    await narrate('Trainer B tries to invite a coach who is already active under Trainer A');
    await loginAs(trainerB.email, trainerB.password);
    await shell(page).goTo('Coaches');
    await page.getByRole('button', { name: 'Invite Coach' }).click();
    const dialog = page.getByRole('dialog', { name: 'Invite a coach' });
    await dialog.getByLabel('Email').fill(coach.email);
    await dialog.getByRole('button', { name: 'Send invite' }).click();

    const error = dialog.getByRole('alert').filter({ hasText: 'This coach is already assigned to another trainer, so they cannot be invited.' });
    await expect(error).toBeVisible();
    await highlight(error);
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByText('No coaches yet')).toBeVisible();

    await narrate('Trainer A re-inviting a coach already on their own roster gets a different message');
    await shell(page).signOut();
    await loginAs(trainerA.email, trainerA.password);
    await shell(page).goTo('Coaches');
    await page.getByRole('button', { name: 'Invite Coach' }).click();
    const dialogA = page.getByRole('dialog', { name: 'Invite a coach' });
    await dialogA.getByLabel('Email').fill(coach.email);
    await dialogA.getByRole('button', { name: 'Send invite' }).click();
    await expect(dialogA.getByRole('alert').filter({ hasText: 'This coach is already on your roster.' })).toBeVisible();
  });
});
