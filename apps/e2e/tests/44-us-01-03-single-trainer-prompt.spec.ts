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
  uniqueName,
} from '../support/test';

/**
 * US-01.03 - "+ Add Child" asks about trainers differently depending on how many trainers the family already has:
 *   none      -> no trainer question at all
 *   exactly 1 -> a Yes/No prompt "Will <child> also train with <trainer>?" (default No; <child> follows the Name field)
 *   2 or more -> the "Connect with trainers (optional)" checklist
 */
test.describe('US-01.03: single-trainer Yes/No prompt in the Add Child form', () => {
  const addChildDialog = (page: Page) => page.getByRole('dialog', { name: 'Add a child profile' });

  async function openAddChild(page: Page) {
    await page.getByRole('button', { name: '+ Add Child' }).click();
    await expect(addChildDialog(page)).toBeVisible();
    return addChildDialog(page);
  }

  async function fillBasics(page: Page, name: string, age = 8) {
    const dialog = addChildDialog(page);
    await dialog.getByLabel('Name').fill(name);
    await dialog.getByLabel('Date of birth').fill(dobForAge(age));
    await dialog.getByLabel('Gender').selectOption({ label: 'FEMALE' });
  }

  test('one trainer: the prompt names the child and the trainer; "Yes" connects the child, "No" does not', async ({ page, api, mailbox, narrate, loginAs }) => {
    const trainer = await createTrainer(api, mailbox);
    const parent = await registerParent(api, await createPlayerLinkCode(api, trainer), { isSelf: true });
    const yesKid = `Mia ${uniqueName('Kid').lastName}`;
    const noKid = `Noah ${uniqueName('Kid').lastName}`;

    await narrate('The parent has exactly one trainer and opens "+ Add Child"');
    await loginAs(parent.email, parent.password);
    await shell(page).goTo('Profiles');
    let dialog = await openAddChild(page);

    await narrate('Before a name is typed the question talks about "your child"');
    const generic = dialog.getByRole('group', { name: `Will your child also train with ${trainer.businessName}?` });
    await expect(generic).toBeVisible();
    await expect(generic.getByRole('radio')).toHaveCount(2);
    await expect(generic.getByRole('radio', { name: 'No' })).toBeChecked();
    await expect(generic.getByRole('radio', { name: 'Yes' })).not.toBeChecked();
    await expect(dialog.getByText('Connect with trainers (optional)')).toHaveCount(0);

    await narrate('Typing the child\'s name personalises the question');
    await fillBasics(page, yesKid, 9);
    const prompt = dialog.getByRole('group', { name: `Will ${yesKid} also train with ${trainer.businessName}?` });
    await expect(prompt).toBeVisible();
    await highlight(prompt);

    await narrate('Answer "Yes" and cancel: the dialog resets, the next time the answer is "No" again');
    await prompt.getByRole('radio', { name: 'Yes' }).check();
    await expect(prompt.getByRole('radio', { name: 'Yes' })).toBeChecked();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
    dialog = await openAddChild(page);
    await expect(dialog.getByRole('group', { name: `Will your child also train with ${trainer.businessName}?` }).getByRole('radio', { name: 'No' })).toBeChecked();

    await narrate(`"Yes": ${yesKid} is created and connected to ${trainer.businessName}`);
    await fillBasics(page, yesKid, 9);
    await dialog.getByRole('group', { name: `Will ${yesKid} also train with ${trainer.businessName}?` }).getByRole('radio', { name: 'Yes' }).check();
    await dialog.getByRole('button', { name: 'Add child' }).click();
    await expect(dialog).toBeHidden();
    const yesCard = page.getByRole('link', { name: yesKid });
    await expect(yesCard).toContainText('1 trainer');
    await highlight(yesCard);

    await narrate(`"No" (the default): ${noKid} is created but not connected`);
    dialog = await openAddChild(page);
    await fillBasics(page, noKid, 6);
    await expect(dialog.getByRole('group', { name: `Will ${noKid} also train with ${trainer.businessName}?` }).getByRole('radio', { name: 'No' })).toBeChecked();
    await dialog.getByRole('button', { name: 'Add child' }).click();
    await expect(dialog).toBeHidden();
    const noCard = page.getByRole('link', { name: noKid });
    await expect(noCard).toContainText('0 trainers');
    await highlight(noCard);

    await narrate('The trainer\'s roster has only the "Yes" child');
    await shell(page).signOut();
    await loginAs(trainer.email, trainer.password);
    await shell(page).goTo('Players');
    const table = page.getByRole('table', { name: 'Player roster' });
    await expect(table.getByRole('row', { name: yesKid })).toBeVisible();
    await expect(table.getByRole('row', { name: noKid })).toHaveCount(0);
    await highlight(table.getByRole('row', { name: yesKid }));
  });

  test('two trainers: the Yes/No prompt is replaced by the "Connect with trainers (optional)" checklist', async ({ page, api, mailbox, narrate, loginAs }) => {
    const trainerA = await createTrainer(api, mailbox);
    const trainerB = await createTrainer(api, mailbox);
    const parent = await registerParent(api, await createPlayerLinkCode(api, trainerA), { isSelf: true });
    await connectProfilesViaLink(api, parent, await createPlayerLinkCode(api, trainerB), [parent.profiles[0].id]);
    const kid = `Ella ${uniqueName('Kid').lastName}`;

    await narrate('A family with two trainers opens "+ Add Child"');
    await loginAs(parent.email, parent.password);
    await shell(page).goTo('Profiles');
    const dialog = await openAddChild(page);
    await fillBasics(page, kid, 10);

    await narrate('No Yes/No question - a checklist with one box per trainer');
    await expect(dialog.getByRole('group', { name: /^Will .* also train with / })).toHaveCount(0);
    await expect(dialog.getByRole('radio')).toHaveCount(0);
    const checklist = dialog.getByRole('group', { name: 'Connect with trainers (optional)' });
    await expect(checklist.getByRole('checkbox')).toHaveCount(2);
    await expect(checklist.getByLabel(trainerA.businessName)).not.toBeChecked();
    await expect(checklist.getByLabel(trainerB.businessName)).not.toBeChecked();
    await highlight(checklist);

    await narrate('Tick only the second trainer');
    await checklist.getByLabel(trainerB.businessName).check();
    await dialog.getByRole('button', { name: 'Add child' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('link', { name: kid })).toContainText('1 trainer');

    await narrate('Trainer B sees the child, trainer A does not');
    await shell(page).signOut();
    await loginAs(trainerB.email, trainerB.password);
    await shell(page).goTo('Players');
    await expect(page.getByRole('table', { name: 'Player roster' }).getByRole('row', { name: kid })).toBeVisible();
    await shell(page).signOut();
    await loginAs(trainerA.email, trainerA.password);
    await shell(page).goTo('Players');
    await expect(page.getByRole('table', { name: 'Player roster' })).toBeVisible();
    await expect(page.getByRole('table', { name: 'Player roster' }).getByRole('row', { name: kid })).toHaveCount(0);
  });

  test('no trainer connected: the form asks no trainer question at all', async ({ page, api, mailbox, narrate, loginAs }) => {
    const trainer = await createTrainer(api, mailbox);
    const parent = await registerParent(api, await createPlayerLinkCode(api, trainer), { isSelf: true });
    const kid = `Finn ${uniqueName('Kid').lastName}`;

    await narrate('The parent disconnects their only profile from the only trainer (API), leaving the family with no trainer');
    const removed = await api.delete(`/player-profiles/${parent.profiles[0].id}/trainers/${trainer.trainerId}`, { auth: parent.session });
    expect(removed.status, JSON.stringify(removed.body)).toBeLessThan(300);

    await loginAs(parent.email, parent.password);
    await shell(page).goTo('Profiles');
    const dialog = await openAddChild(page);
    await fillBasics(page, kid, 7);

    await narrate('Neither the Yes/No question nor the checklist is shown');
    await expect(dialog.getByRole('group', { name: /^Will .* also train with / })).toHaveCount(0);
    await expect(dialog.getByRole('group', { name: 'Connect with trainers (optional)' })).toHaveCount(0);
    await expect(dialog.getByRole('radio')).toHaveCount(0);
    await expect(dialog.getByRole('checkbox')).toHaveCount(0);
    await highlight(dialog);

    await narrate('The child is simply created without trainers');
    await dialog.getByRole('button', { name: 'Add child' }).click();
    await expect(dialog).toBeHidden();
    const card = page.getByRole('link', { name: kid });
    await expect(card).toContainText('0 trainers');
    await highlight(card);
  });
});
