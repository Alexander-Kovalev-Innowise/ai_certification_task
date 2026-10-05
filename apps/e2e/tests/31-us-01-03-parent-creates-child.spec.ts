import type { Page } from '@playwright/test';

import {
  test,
  expect,
  highlight,
  shell,
  createTrainer,
  createPlayerLinkCode,
  registerParent,
  connectProfilesViaLink,
  dobForAge,
  makePng,
  uniqueName,
} from '../support/test';

/**
 * US-01.03 - Parent creates a child profile.
 * /profiles -> "+ Add Child" (name, date of birth -> age 1-18, gender, optional school + photo, trainer checklist) ->
 * profile card appears, parent context switcher gets the child entries; duplicate warning; "Add myself as a player".
 * (The spec's single-trainer "Will X also train with Y? Yes/No" prompt is implemented as the same optional trainer checklist.)
 */
test.describe('US-01.03: Parent creates a child profile', () => {
  const addChildDialog = (page: Page) => page.getByRole('dialog', { name: 'Add a child profile' });

  async function openAddChild(page: Page) {
    await page.getByRole('button', { name: '+ Add Child' }).click();
    await expect(addChildDialog(page)).toBeVisible();
    return addChildDialog(page);
  }

  test('validation: name, date of birth and gender are required; age must be 1-18', async ({ page, api, mailbox, narrate, loginAs }) => {
    const trainer = await createTrainer(api, mailbox);
    const parent = await registerParent(api, await createPlayerLinkCode(api, trainer), { isSelf: true });

    await narrate('The parent signs in and opens Profiles, then clicks "+ Add Child"');
    await loginAs(parent.email, parent.password);
    await shell(page).goTo('Profiles');
    await expect(page.getByRole('heading', { name: 'Profiles', level: 1 })).toBeVisible();
    const dialog = await openAddChild(page);

    await narrate('Submitting the empty form: name, date of birth and gender are required');
    await dialog.getByRole('button', { name: 'Add child' }).click();
    await expect(dialog.getByText('Name is required.')).toBeVisible();
    await expect(dialog.getByText('Date of birth is required.')).toBeVisible();
    await expect(dialog.getByText('Select a gender.')).toBeVisible();
    await highlight(dialog);

    const name = `Kid ${uniqueName('Kid').lastName}`;
    await dialog.getByLabel('Name').fill(name);
    await dialog.getByLabel('Gender').selectOption({ label: 'FEMALE' });

    await narrate('Age bounds: a baby born today (age 0) is rejected');
    await dialog.getByLabel('Date of birth').fill(new Date().toISOString().slice(0, 10));
    await dialog.getByRole('button', { name: 'Add child' }).click();
    await expect(dialog.getByText('Age must be between 1 and 18 years.')).toBeVisible();

    await narrate('Age bounds: 20 years old is rejected (adults use their own accounts)');
    await dialog.getByLabel('Date of birth').fill(dobForAge(20));
    await dialog.getByRole('button', { name: 'Add child' }).click();
    await expect(dialog.getByText('Age must be between 1 and 18 years.')).toBeVisible();
    await highlight(dialog.getByText('Age must be between 1 and 18 years.'));

    await narrate('The server enforces the same rule (API check for a 19-year-old and a 0-year-old)');
    for (const dateOfBirth of [dobForAge(19), new Date().toISOString().slice(0, 10)]) {
      const res = await api.post('/player-profiles', { auth: parent.session, body: { name, dateOfBirth, gender: 'MALE' } });
      expect(res.status).toBe(400);
    }

    await narrate('Exactly 1 and 18 years are accepted - the boundary ages');
    await dialog.getByLabel('Date of birth').fill(dobForAge(1));
    await dialog.getByRole('button', { name: 'Add child' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('link', { name })).toBeVisible();
  });

  test('create a child with school and photo: the profile appears on Profiles and keeps its details', async ({ page, api, mailbox, narrate, loginAs }) => {
    const trainer = await createTrainer(api, mailbox);
    const parent = await registerParent(api, await createPlayerLinkCode(api, trainer), { isSelf: true });
    const childName = `Maya ${uniqueName('Kid').lastName}`;

    await loginAs(parent.email, parent.password);
    await shell(page).goTo('Profiles');
    await narrate('Click "+ Add Child" and fill in name, date of birth, gender and school');
    const dialog = await openAddChild(page);
    await dialog.getByLabel('Name').fill(childName);
    await dialog.getByLabel('Date of birth').fill(dobForAge(8));
    await dialog.getByLabel('Gender').selectOption({ label: 'FEMALE' });
    await dialog.getByLabel('School (optional)').fill('Lincoln Elementary School');

    await narrate('Upload a photo: a preview appears right away');
    await dialog.getByLabel('Photo (optional)').setInputFiles({ name: 'maya.png', mimeType: 'image/png', buffer: makePng([30, 160, 90], 120) });
    const preview = dialog.getByAltText('Photo preview');
    await expect(preview).toBeVisible();
    await highlight(preview);

    await narrate('The parent has one trainer, offered as an optional connection; leave it unticked');
    await expect(dialog.getByText('Connect with trainers (optional)')).toBeVisible();
    await expect(dialog.getByLabel(trainer.businessName)).not.toBeChecked();
    await dialog.getByRole('button', { name: 'Add child' }).click();
    await expect(dialog).toBeHidden();

    await narrate('The child appears on the Profiles page next to the parent ("Me"), with 0 trainers');
    const card = page.getByRole('link', { name: childName });
    await expect(card).toBeVisible();
    await expect(card).toContainText('0 trainers');
    await expect(card.locator('img')).toHaveAttribute('src', /\/uploads\//);
    await expect(page.getByRole('link', { name: parent.profiles[0].name })).toContainText('Me');
    await highlight(card);

    await narrate('Opening the profile shows the saved details');
    await card.click();
    await expect(page.getByRole('heading', { name: childName, level: 1 })).toBeVisible();
    await expect(page.getByLabel('Name', { exact: true })).toHaveValue(childName);
    await expect(page.getByLabel('School')).toHaveValue('Lincoln Elementary School');
    await expect(page.getByAltText('Photo preview')).toBeVisible();
    await expect(page.getByText('No trainers yet — add one to get started.')).toBeVisible();

    await narrate('The child is linked to the parent account (no independent account: only the parent can sign in)');
    const profiles = await api.get<Array<{ id: string; name: string; isSelf: boolean }>>('/player-profiles', { auth: parent.session });
    expect(profiles.body.find((p) => p.name === childName)).toMatchObject({ isSelf: false });
  });

  test('trainer selection: nothing selected = not associated; one or several trainers selected = associated with exactly those', async ({
    page,
    api,
    mailbox,
    narrate,
    loginAs,
  }) => {
    const trainerA = await createTrainer(api, mailbox);
    const trainerB = await createTrainer(api, mailbox);
    const parent = await registerParent(api, await createPlayerLinkCode(api, trainerA), { isSelf: true });
    await connectProfilesViaLink(api, parent, await createPlayerLinkCode(api, trainerB), [parent.profiles[0].id]);
    const noTrainerKid = `Zoe ${uniqueName('Kid').lastName}`;
    const oneTrainerKid = `Leo ${uniqueName('Kid').lastName}`;
    const bothKid = `Eva ${uniqueName('Kid').lastName}`;

    await loginAs(parent.email, parent.password);
    await shell(page).goTo('Profiles');

    await narrate('With several trainers the form shows a checklist: "Connect with trainers (optional)"');
    let dialog = await openAddChild(page);
    await dialog.getByLabel('Name').fill(noTrainerKid);
    await dialog.getByLabel('Date of birth').fill(dobForAge(7));
    await dialog.getByLabel('Gender').selectOption({ label: 'MALE' });
    await expect(dialog.getByLabel(trainerA.businessName)).toBeVisible();
    await expect(dialog.getByLabel(trainerB.businessName)).toBeVisible();
    await highlight(dialog.getByRole('group', { name: 'Connect with trainers (optional)' }));
    await narrate('None selected: the profile is created but not associated with any trainer');
    await dialog.getByRole('button', { name: 'Add child' }).click();
    await expect(page.getByRole('link', { name: noTrainerKid })).toContainText('0 trainers');

    await narrate('Select only trainer A');
    dialog = await openAddChild(page);
    await dialog.getByLabel('Name').fill(oneTrainerKid);
    await dialog.getByLabel('Date of birth').fill(dobForAge(9));
    await dialog.getByLabel('Gender').selectOption({ label: 'MALE' });
    await dialog.getByLabel(trainerA.businessName).check();
    await dialog.getByRole('button', { name: 'Add child' }).click();
    await expect(page.getByRole('link', { name: oneTrainerKid })).toContainText('1 trainer');

    await narrate('Select both trainers');
    dialog = await openAddChild(page);
    await dialog.getByLabel('Name').fill(bothKid);
    await dialog.getByLabel('Date of birth').fill(dobForAge(11));
    await dialog.getByLabel('Gender').selectOption({ label: 'FEMALE' });
    await dialog.getByLabel(trainerA.businessName).check();
    await dialog.getByLabel(trainerB.businessName).check();
    await dialog.getByRole('button', { name: 'Add child' }).click();
    await expect(page.getByRole('link', { name: bothKid })).toContainText('2 trainers');

    await narrate('The parent context switcher lists the children under "Your Children\'s Training"');
    const select = page.getByRole('combobox', { name: 'Active trainer context' });
    const children = select.locator('optgroup[label="Your Children\'s Training"]');
    await expect(children.getByRole('option', { name: `${oneTrainerKid} → ${trainerA.businessName}` })).toHaveCount(1);
    await expect(children.getByRole('option', { name: `${oneTrainerKid} → ${trainerB.businessName}` })).toHaveCount(0);
    await expect(children.getByRole('option', { name: `${bothKid} → ${trainerA.businessName}` })).toHaveCount(1);
    await expect(children.getByRole('option', { name: `${bothKid} → ${trainerB.businessName}` })).toHaveCount(1);
    await expect(select.getByRole('option', { name: new RegExp(noTrainerKid) })).toHaveCount(0);
    await highlight(select);

    await narrate('Trainer B sees only the child that was connected to them');
    await shell(page).signOut();
    await loginAs(trainerB.email, trainerB.password);
    await shell(page).goTo('Players');
    const table = page.getByRole('table', { name: 'Player roster' });
    await expect(table.getByRole('row', { name: bothKid })).toBeVisible();
    await expect(table.getByRole('row', { name: oneTrainerKid })).toHaveCount(0);
    await expect(table.getByRole('row', { name: noTrainerKid })).toHaveCount(0);
  });

  test('duplicate check: a profile with the same name and birth date only triggers a non-blocking warning', async ({ page, api, mailbox, narrate, loginAs }) => {
    const trainer = await createTrainer(api, mailbox);
    const parent = await registerParent(api, await createPlayerLinkCode(api, trainer), { isSelf: true });
    const childName = `Twin ${uniqueName('Kid').lastName}`;
    const dob = dobForAge(6);

    await loginAs(parent.email, parent.password);
    await shell(page).goTo('Profiles');

    for (const round of ['first', 'second (same name and birth date)']) {
      await narrate(`Add the ${round} child`);
      const dialog = await openAddChild(page);
      await dialog.getByLabel('Name').fill(childName);
      await dialog.getByLabel('Date of birth').fill(dob);
      await dialog.getByLabel('Gender').selectOption({ label: 'OTHER' });
      await dialog.getByRole('button', { name: 'Add child' }).click();
      await expect(dialog).toBeHidden();
    }

    const warning = page.getByRole('status').filter({ hasText: 'A profile with this name and date of birth already exists on this account' });
    await expect(warning).toBeVisible();
    await highlight(warning);
    await narrate('The warning does not block: both profiles exist');
    await expect(page.getByRole('link', { name: childName })).toHaveCount(2);
  });

  test('"Add myself as a player": a parent who registered only a child can train too', async ({ page, api, mailbox, narrate, loginAs }) => {
    const trainer = await createTrainer(api, mailbox);
    const parent = await registerParent(api, await createPlayerLinkCode(api, trainer), { isSelf: false });
    const childName = parent.profiles[0].name;
    const ownName = `${parent.firstName} ${parent.lastName}`;

    await narrate('A parent who only registered a child signs in and opens Profiles');
    await loginAs(parent.email, parent.password);
    await shell(page).goTo('Profiles');
    await expect(page.getByRole('link', { name: childName })).toBeVisible();
    await expect(page.getByRole('link', { name: childName })).not.toContainText('Me');
    const addSelf = page.getByRole('button', { name: 'Add myself as a player' });
    await expect(addSelf).toBeVisible();
    await highlight(addSelf);

    await narrate('The form is pre-filled with the account name; a future birth date is rejected');
    await addSelf.click();
    const dialog = page.getByRole('dialog', { name: 'Add myself as a player' });
    await expect(dialog.getByLabel('Name')).toHaveValue(ownName);
    await dialog.getByRole('button', { name: 'Add myself' }).click();
    await expect(dialog.getByText('Date of birth is required.')).toBeVisible();
    await expect(dialog.getByText('Select a gender.')).toBeVisible();
    const tomorrow = new Date(Date.now() + 2 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    await dialog.getByLabel('Date of birth').fill(tomorrow);
    await dialog.getByLabel('Gender').selectOption({ label: 'female' });
    await dialog.getByRole('button', { name: 'Add myself' }).click();
    await expect(dialog.getByText('Date of birth cannot be in the future.')).toBeVisible();

    await narrate('An adult date of birth is fine here (the 1-18 rule is only for children)');
    await dialog.getByLabel('Date of birth').fill(dobForAge(35));
    await dialog.getByRole('button', { name: 'Add myself' }).click();
    await expect(dialog).toBeHidden();

    await narrate('The parent now has a "Me" profile and the button is gone');
    const own = page.getByRole('link', { name: ownName });
    await expect(own).toBeVisible();
    await expect(own).toContainText('Me');
    await expect(addSelf).toHaveCount(0);
    await highlight(own);

    await narrate('Connect the parent herself with the trainer through the profile (Add Trainer)');
    await own.click();
    await page.getByRole('button', { name: 'Add Trainer' }).click();
    await page.getByLabel('Pick from my trainers').check();
    await page.getByLabel('Trainer', { exact: true }).selectOption({ label: trainer.businessName });
    await page.getByRole('dialog', { name: 'Add a trainer' }).getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.getByRole('row', { name: trainer.businessName })).toBeVisible();
    await shell(page).goTo('Dashboard');
    const select = page.getByRole('combobox', { name: 'Active trainer context' });
    await expect(select.locator('optgroup[label="Your Training"]').getByRole('option', { name: `${ownName} (Me) → ${trainer.businessName}` })).toHaveCount(1);
    await expect(select.locator('optgroup[label="Your Children\'s Training"]').getByRole('option', { name: `${childName} → ${trainer.businessName}` })).toHaveCount(1);
    await highlight(select);
  });
});
