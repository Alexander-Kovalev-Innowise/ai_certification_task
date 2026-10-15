import type { Page } from '@playwright/test';

import {
  test,
  expect,
  highlight,
  createTrainer,
  createPlayerLinkCode,
  showEmail,
  sql,
  strongPassword,
  uniqueEmail,
  uniqueName,
} from '../support/test';

/**
 * Camp-to-User Conversion (Epic-01 side of the Epic-08 camp / evaluation form).
 * Stand-in public form /camp/<code> -> "Thanks! Create your account" -> /join/<code>?camp=<token> arrives pre-filled
 * (the person only adds a password) -> portal already associated with the trainer. Alternative: email the join link for later.
 * Also: an expired token falls back to the normal empty form with an explanation.
 */
test.describe('Camp-to-User Conversion', () => {
  const contextCurrent = (page: Page) => page.getByTestId('context-switcher-current');

  async function fillCampForm(page: Page, who: { parentFirst: string; parentLast: string; email: string; playerName: string; age: string }) {
    await page.getByLabel('Your first name').fill(who.parentFirst);
    await page.getByLabel('Your last name').fill(who.parentLast);
    await page.getByLabel('Email').fill(who.email);
    await page.getByLabel('Country calling code').selectOption({ label: '+1 United States' });
    await page.getByLabel('Phone number').fill('4155552671');
    await page.getByLabel("Player's name").fill(who.playerName);
    await page.getByLabel("Player's age").fill(who.age);
    await page.getByLabel('Gender').selectOption({ label: 'female' });
  }

  function person() {
    const parent = uniqueName('Campparent');
    const child = uniqueName('Campkid');
    return {
      parentFirst: parent.firstName,
      parentLast: parent.lastName,
      email: uniqueEmail('camper'),
      playerName: `${child.firstName} ${child.lastName}`,
      age: '10',
    };
  }

  test('camp sign-up -> "Create account now" arrives pre-filled, only a password is needed, and the portal shows the trainer', async ({
    page,
    api,
    mailbox,
    narrate,
  }) => {
    const trainer = await createTrainer(api, mailbox);
    const code = await createPlayerLinkCode(api, trainer);
    const who = person();
    const password = strongPassword();

    await narrate('A parent fills in the trainer\'s camp / evaluation sign-up (public stand-in for the Epic-08 form)');
    await page.goto(`/camp/${code}`);
    await expect(page.getByRole('heading', { name: 'Camp / evaluation sign-up (Epic-08 stand-in)' })).toBeVisible();
    await expect(page.getByText(trainer.businessName)).toBeVisible();

    await narrate('Required fields are validated before anything is sent');
    await page.getByRole('button', { name: 'Submit sign-up' }).click();
    await expect(page.getByText('Email is required.')).toBeVisible();
    await expect(page.getByText('Age is required.')).toBeVisible();

    await narrate('Parent, contact and player details (10 year old girl)');
    await fillCampForm(page, who);
    await page.getByRole('button', { name: 'Submit sign-up' }).click();

    await narrate('Right after the submission the person is prompted to create an account');
    const success = page.getByTestId('camp-success');
    await expect(success.getByText('Create your PracticePerfect account to see schedules.')).toBeVisible();
    await expect(success.getByRole('link', { name: 'Create account now' })).toBeVisible();
    await expect(success.getByRole('button', { name: 'Email me the link for later' })).toBeVisible();
    await highlight(success);

    await narrate('"Create account now" opens the registration - every field is already filled in from the sign-up');
    await success.getByRole('link', { name: 'Create account now' }).click();
    await expect(page).toHaveURL(new RegExp(`/join/${code}\\?camp=`));
    await expect(page.getByRole('heading', { name: `Join ${trainer.businessName}` })).toBeVisible();
    await expect(page.getByText(/We pre-filled this from your camp sign-up/)).toBeVisible();
    await expect(page.getByLabel('Your first name')).toHaveValue(who.parentFirst);
    await expect(page.getByLabel('Your last name')).toHaveValue(who.parentLast);
    await expect(page.getByLabel('Email')).toHaveValue(who.email);
    await expect(page.getByLabel("Player's name")).toHaveValue(who.playerName);
    await expect(page.getByLabel('Who is this registration for?')).toHaveValue('false');
    await expect(page.getByLabel('Gender')).toHaveValue('FEMALE');
    await highlight(page.getByText(/We pre-filled this from your camp sign-up/));

    await narrate('The only thing left to type is a password');
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByRole('status').filter({ hasText: `Welcome, ${who.parentFirst}!` })).toBeVisible();

    await narrate('The new account lands in the portal already associated with the trainer - nothing to re-enter, no manual connect step');
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 });
    await expect(contextCurrent(page)).toContainText(who.playerName);
    await expect(contextCurrent(page)).toContainText(trainer.businessName);
    await highlight(contextCurrent(page));

    await narrate('The association records where the player came from');
    const rows = await sql(
      `SELECT a.source FROM "PlayerTrainerAssociation" a JOIN "PlayerProfile" p ON p.id = a."playerProfileId" WHERE p.name = $1`,
      [who.playerName],
    );
    expect(rows.rows).toEqual([{ source: 'CAMP' }]);

    await narrate('The sign-up token is consumed in the same transaction as the account, so it cannot be replayed');
    const used = await sql(`SELECT "usedAt" FROM "CampConversion" WHERE payload->>'email' = $1`, [who.email]);
    expect(used.rows[0].usedAt).not.toBeNull();
  });

  test('"Email me the link for later": the mailed link opens the pre-filled registration', async ({ page, api, mailbox, narrate }) => {
    const trainer = await createTrainer(api, mailbox);
    const code = await createPlayerLinkCode(api, trainer);
    const who = person();

    await narrate('Same sign-up, but the person is not ready to create the account yet');
    await page.goto(`/camp/${code}`);
    await fillCampForm(page, who);
    await page.getByRole('button', { name: 'Submit sign-up' }).click();
    await page.getByRole('button', { name: 'Email me the link for later' }).click();
    await expect(page.getByText(`We emailed the link to ${who.email}`)).toBeVisible();
    await highlight(page.getByText(`We emailed the link to ${who.email}`));

    await narrate('The mail arrives with a join link that carries the sign-up token');
    const mail = await mailbox.waitFor(who.email, { subject: /Finish creating your PracticePerfect account/ });
    expect(mail.text).toContain(trainer.businessName);
    const link = mail.links.find((l) => l.includes(`/join/${code}?camp=`));
    expect(link, `no join link in ${JSON.stringify(mail.links)}`).toBeTruthy();
    await showEmail(page, mail);

    await narrate('Days later the link is opened: the registration is pre-filled and only needs a password');
    await page.goto(link!);
    await expect(page.getByText(/We pre-filled this from your camp sign-up/)).toBeVisible();
    await expect(page.getByLabel('Email')).toHaveValue(who.email);
    await expect(page.getByLabel("Player's name")).toHaveValue(who.playerName);
    await page.getByLabel('Password', { exact: true }).fill(strongPassword());
    await page.getByRole('button', { name: 'Create account' }).click();

    await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 });
    await expect(contextCurrent(page)).toContainText(trainer.businessName);
    await highlight(contextCurrent(page));
  });

  test('an expired sign-up link explains itself and falls back to the normal empty form', async ({ page, api, mailbox, narrate }) => {
    const trainer = await createTrainer(api, mailbox);
    const code = await createPlayerLinkCode(api, trainer);
    const who = person();

    await narrate('A sign-up whose 7 days are over');
    await page.goto(`/camp/${code}`);
    await fillCampForm(page, who);
    await page.getByRole('button', { name: 'Submit sign-up' }).click();
    const href = await page.getByRole('link', { name: 'Create account now' }).getAttribute('href');
    await sql(`UPDATE "CampConversion" SET "expiresAt" = now() - interval '1 hour' WHERE payload->>'email' = $1`, [who.email]);

    await narrate('The join page says the link expired and shows the ordinary, empty registration form');
    await page.goto(href!);
    await expect(page.getByText(/Your camp sign-up link has expired/)).toBeVisible();
    await expect(page.getByLabel('Email')).toHaveValue('');
    await expect(page.getByText(/We pre-filled this from your camp sign-up/)).toHaveCount(0);
    await highlight(page.getByText(/Your camp sign-up link has expired/));
  });
});
