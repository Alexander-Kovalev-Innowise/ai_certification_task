import type { Page } from '@playwright/test';

import {
  test,
  expect,
  highlight,
  shell,
  createTrainer,
  createPlayerLinkCode,
  registerParent,
  addChildProfile,
  connectProfilesViaLink,
  createChildLogin,
  sql,
  uniqueName,
} from '../support/test';

/**
 * US-01.04 - Parent manages child-trainer associations.
 * /profiles/[id]: trainers with connection dates, "Add Trainer" by ShareLink code or from "My Trainers", "Remove" with a confirmation
 * (RSVP warning), the trainer's roster follows; the three context-selector formats (parent who trains / who does not / child login).
 */
test.describe('US-01.04: Parent manages child-trainer associations', () => {
  const trainerRows = (page: Page) => page.getByRole('table', { name: 'Trainer associations' });
  const addTrainerDialog = (page: Page) => page.getByRole('dialog', { name: 'Add a trainer' });

  test('profile page lists the child\'s trainers with their connection dates', async ({ page, api, mailbox, narrate, loginAs }) => {
    const trainerA = await createTrainer(api, mailbox);
    const trainerB = await createTrainer(api, mailbox);
    const parent = await registerParent(api, await createPlayerLinkCode(api, trainerA), { isSelf: true });
    await connectProfilesViaLink(api, parent, await createPlayerLinkCode(api, trainerB), [parent.profiles[0].id]);
    const childName = `Nina ${uniqueName('Kid').lastName}`;
    const child = await addChildProfile(api, parent, { name: childName, trainerIds: [trainerA.trainerId, trainerB.trainerId] });
    const noTrainerName = `Owen ${uniqueName('Kid').lastName}`;
    await addChildProfile(api, parent, { name: noTrainerName });

    await narrate('The parent opens Profiles: every family member with the number of trainers');
    await loginAs(parent.email, parent.password);
    await shell(page).goTo('Profiles');
    await expect(page.getByRole('link', { name: childName })).toContainText('2 trainers');
    await expect(page.getByRole('link', { name: noTrainerName })).toContainText('0 trainers');

    await narrate('Open a child: name, age-independent details and "Trainers" with the connection date');
    await page.getByRole('link', { name: childName }).click();
    await expect(page).toHaveURL(new RegExp(`/profiles/${child.id}$`));
    await expect(page.getByRole('heading', { name: childName, level: 1 })).toBeVisible();
    const table = trainerRows(page);
    await expect(table.getByRole('row')).toHaveCount(2);
    for (const trainer of [trainerA, trainerB]) {
      const row = table.getByRole('row', { name: trainer.businessName });
      await expect(row).toContainText(/Connected \d{1,2}\/\d{1,2}\/\d{4}/);
      await expect(row).toContainText('ACTIVE');
      await expect(row.getByRole('button', { name: 'Remove' })).toBeVisible();
    }
    await highlight(table);

    await narrate('A child without trainers shows the empty state');
    await page.goBack();
    await page.getByRole('link', { name: noTrainerName }).click();
    await expect(page.getByText('No trainers yet — add one to get started.')).toBeVisible();
    await highlight(page.getByText('No trainers yet — add one to get started.'));
  });

  test('Add Trainer: by ShareLink code and from "My Trainers"; the new trainer sees the child on their roster', async ({
    page,
    api,
    mailbox,
    narrate,
    loginAs,
  }) => {
    const trainerA = await createTrainer(api, mailbox);
    const trainerB = await createTrainer(api, mailbox);
    const trainerC = await createTrainer(api, mailbox);
    const parent = await registerParent(api, await createPlayerLinkCode(api, trainerA), { isSelf: true });
    await connectProfilesViaLink(api, parent, await createPlayerLinkCode(api, trainerB), [parent.profiles[0].id]);
    const codeC = await createPlayerLinkCode(api, trainerC);
    const childName = `Ivy ${uniqueName('Kid').lastName}`;
    const child = await addChildProfile(api, parent, { name: childName, trainerIds: [trainerA.trainerId] });

    await loginAs(parent.email, parent.password);
    await page.goto(`/profiles/${child.id}`);
    await expect(trainerRows(page).getByRole('row')).toHaveCount(1);

    await narrate('Option B: "Pick from my trainers" - trainers the parent is already associated with');
    await page.getByRole('button', { name: 'Add Trainer' }).click();
    let dialog = addTrainerDialog(page);
    await expect(dialog.getByLabel('Enter a share link code')).toBeChecked();
    await dialog.getByLabel('Pick from my trainers').check();
    await dialog.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(dialog.getByText('Select a trainer.')).toBeVisible();
    const picker = dialog.getByLabel('Trainer', { exact: true });
    await expect(picker.getByRole('option', { name: trainerA.businessName })).toHaveCount(1);
    await expect(picker.getByRole('option', { name: trainerB.businessName })).toHaveCount(1);
    await expect(picker.getByRole('option', { name: trainerC.businessName })).toHaveCount(0);
    await picker.selectOption({ label: trainerB.businessName });
    await highlight(dialog);
    await dialog.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(trainerRows(page).getByRole('row', { name: trainerB.businessName })).toBeVisible();

    await narrate('Option A: enter a ShareLink code - a pasted full URL is rejected, a wrong code is refused');
    await page.getByRole('button', { name: 'Add Trainer' }).click();
    dialog = addTrainerDialog(page);
    await dialog.getByRole('textbox', { name: 'Share link code' }).fill(`http://localhost:3101/join/${codeC}`);
    await dialog.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(dialog.getByText('Share link codes only contain letters, numbers, hyphens and underscores.', { exact: false })).toBeVisible();
    await dialog.getByRole('textbox', { name: 'Share link code' }).fill('unknownCode123');
    await dialog.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(dialog.getByRole('alert').filter({ hasText: 'Something went wrong adding this trainer.' })).toBeVisible();
    await expect(trainerRows(page).getByRole('row', { name: trainerC.businessName })).toHaveCount(0);

    await narrate('The correct code of trainer C associates the child');
    await dialog.getByRole('textbox', { name: 'Share link code' }).fill(codeC);
    await dialog.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(dialog).toBeHidden();
    const rowC = trainerRows(page).getByRole('row', { name: trainerC.businessName });
    await expect(rowC).toBeVisible();
    await expect(trainerRows(page).getByRole('row')).toHaveCount(3);
    await highlight(rowC);

    await narrate('The child can now see the trainer; the context switcher offers the new entry');
    const select = page.getByRole('combobox', { name: 'Active trainer context' });
    await expect(select.getByRole('option', { name: `${childName} → ${trainerC.businessName}` })).toHaveCount(1);
    await expect(select.getByRole('option', { name: `${childName} → ${trainerB.businessName}` })).toHaveCount(1);

    await narrate('Trainer C sees the child on the roster; the parent herself was NOT added');
    await shell(page).signOut();
    await loginAs(trainerC.email, trainerC.password);
    await shell(page).goTo('Players');
    const table = page.getByRole('table', { name: 'Player roster' });
    await expect(table.getByRole('row', { name: childName })).toBeVisible();
    await expect(table.getByRole('row', { name: parent.profiles[0].name })).toHaveCount(0);
  });

  test('Remove: confirmation warns about RSVPs; after confirming the trainer no longer sees the child, history is preserved', async ({
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
    const childName = `Rex ${uniqueName('Kid').lastName}`;
    const child = await addChildProfile(api, parent, { name: childName, trainerIds: [trainerA.trainerId, trainerB.trainerId] });

    await loginAs(parent.email, parent.password);
    await page.goto(`/profiles/${child.id}`);
    const row = trainerRows(page).getByRole('row', { name: trainerA.businessName });
    await expect(row).toBeVisible();

    await narrate('Click "Remove" next to trainer A: a confirmation explains the consequence');
    await row.getByRole('button', { name: 'Remove' }).click();
    const dialog = page.getByRole('dialog', { name: `Remove ${trainerA.businessName}?` });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('This will cancel all upcoming RSVPs with this trainer.', { exact: false })).toBeVisible();
    await highlight(dialog);

    await narrate('Cancel keeps the association');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
    await expect(row).toBeVisible();

    await narrate('Confirm: the child is disassociated from trainer A only');
    await row.getByRole('button', { name: 'Remove' }).click();
    await dialog.getByRole('button', { name: 'Yes, remove' }).click();
    await expect(dialog).toBeHidden();
    await expect(row).toHaveCount(0);
    await expect(trainerRows(page).getByRole('row', { name: trainerB.businessName })).toBeVisible();

    await narrate('The context switcher no longer offers the removed trainer for this child');
    const select = page.getByRole('combobox', { name: 'Active trainer context' });
    await expect(select.getByRole('option', { name: `${childName} → ${trainerA.businessName}` })).toHaveCount(0);
    await expect(select.getByRole('option', { name: `${childName} → ${trainerB.businessName}` })).toHaveCount(1);
    await expect(select.getByRole('option', { name: `${parent.profiles[0].name} (Me) → ${trainerA.businessName}` })).toHaveCount(1);

    await narrate('Soft delete: the association is INACTIVE with a disconnect date - history is kept, not erased');
    const rows = await sql(
      `SELECT a.status, a."disconnectedAt" IS NOT NULL AS disconnected
         FROM "PlayerTrainerAssociation" a WHERE a."playerProfileId" = $1 AND a."trainerId" = $2`,
      [child.id, trainerA.trainerId],
    );
    expect(rows.rows).toEqual([{ status: 'INACTIVE', disconnected: true }]);

    await narrate('Trainer A no longer sees the child; trainer B still does');
    await shell(page).signOut();
    await loginAs(trainerA.email, trainerA.password);
    await shell(page).goTo('Players');
    await expect(page.getByRole('table', { name: 'Player roster' }).getByRole('row', { name: childName })).toHaveCount(0);
    await expect(page.getByRole('table', { name: 'Player roster' }).getByRole('row', { name: parent.profiles[0].name })).toBeVisible();
    await shell(page).signOut();
    await loginAs(trainerB.email, trainerB.password);
    await shell(page).goTo('Players');
    await expect(page.getByRole('table', { name: 'Player roster' }).getByRole('row', { name: childName })).toBeVisible();
  });

  test('context selector formats: parent who also trains, parent who does not, child with own login', async ({ page, api, mailbox, narrate, loginAs }) => {
    const bob = await createTrainer(api, mailbox);
    const lisa = await createTrainer(api, mailbox);

    // Parent who also trains: self (Bob + Lisa), Alex (Bob), Maya (Bob + Lisa)
    const trains = await registerParent(api, await createPlayerLinkCode(api, bob), { isSelf: true });
    const selfId = trains.profiles[0].id;
    const selfName = trains.profiles[0].name;
    await connectProfilesViaLink(api, trains, await createPlayerLinkCode(api, lisa), [selfId]);
    const alex = await addChildProfile(api, trains, { name: `Alex ${uniqueName('Kid').lastName}`, trainerIds: [bob.trainerId] });
    const maya = await addChildProfile(api, trains, { name: `Maya ${uniqueName('Kid').lastName}`, trainerIds: [bob.trainerId, lisa.trainerId] });

    // Parent who does not train: children only
    const noTrain = await registerParent(api, await createPlayerLinkCode(api, bob), { isSelf: false });
    const noTrainChild = noTrain.profiles[0];
    const noTrainSecond = await addChildProfile(api, noTrain, { name: `Emma ${uniqueName('Kid').lastName}`, trainerIds: [bob.trainerId] });

    // Child with own login: Maya trains with Bob and Lisa
    const mayaLogin = await createChildLogin(api, trains, maya);

    await narrate('FORMAT 1 - parent who also trains: "Your Training" + "Your Children\'s Training"');
    await loginAs(trains.email, trains.password);
    const select = page.getByRole('combobox', { name: 'Active trainer context' });
    const own = select.locator('optgroup[label="Your Training"]');
    const kids = select.locator('optgroup[label="Your Children\'s Training"]');
    await expect(own.getByRole('option')).toHaveCount(2);
    await expect(own.getByRole('option', { name: `${selfName} (Me) → ${bob.businessName}` })).toHaveCount(1);
    await expect(own.getByRole('option', { name: `${selfName} (Me) → ${lisa.businessName}` })).toHaveCount(1);
    await expect(kids.getByRole('option')).toHaveCount(3);
    await expect(kids.getByRole('option', { name: `${alex.name} → ${bob.businessName}` })).toHaveCount(1);
    await expect(kids.getByRole('option', { name: `${maya.name} → ${bob.businessName}` })).toHaveCount(1);
    await expect(kids.getByRole('option', { name: `${maya.name} → ${lisa.businessName}` })).toHaveCount(1);
    await expect(page.getByText('Your Training:', { exact: false }).first()).toContainText(`${selfName} (Me)`);
    await highlight(select);
    await narrate('Select a child entry: the current context reads "Child → Trainer"');
    await select.selectOption({ label: `${alex.name} → ${bob.businessName}` });
    await expect(page.getByTestId('context-switcher-current')).toHaveText(`${alex.name} → ${bob.businessName}`);

    await narrate("FORMAT 2 - parent who doesn't train: only \"Your Children's Training\"");
    await shell(page).signOut();
    await loginAs(noTrain.email, noTrain.password);
    await expect(select.locator('optgroup[label="Your Training"]')).toHaveCount(0);
    const kids2 = select.locator('optgroup[label="Your Children\'s Training"]');
    await expect(kids2.getByRole('option')).toHaveCount(2);
    await expect(kids2.getByRole('option', { name: `${noTrainChild.name} → ${bob.businessName}` })).toHaveCount(1);
    await expect(kids2.getByRole('option', { name: `${noTrainSecond.name} → ${bob.businessName}` })).toHaveCount(1);
    await expect(page.getByText('(Me)')).toHaveCount(0);
    await highlight(select);

    await narrate('FORMAT 3 - child with own login: just the trainers, no "Me" / parent sections');
    await shell(page).signOut();
    await loginAs(mayaLogin.email, mayaLogin.password);
    await expect(select.locator('optgroup')).toHaveCount(0);
    await expect(select.getByRole('option')).toHaveCount(2);
    await expect(select.getByRole('option', { name: bob.businessName, exact: true })).toHaveCount(1);
    await expect(select.getByRole('option', { name: lisa.businessName, exact: true })).toHaveCount(1);
    await expect(page.getByText(`Your Training: ${[bob.businessName, lisa.businessName].join(' · ')}`).or(page.getByText(`Your Training: ${[lisa.businessName, bob.businessName].join(' · ')}`))).toBeVisible();
    await expect(page.getByText(alex.name)).toHaveCount(0);
    await highlight(select);
  });
});
