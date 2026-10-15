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
  setPlayerAvailability,
  minutes,
  uniqueName,
} from '../support/test';

/**
 * US-01.09 "Best Times" - two UI details:
 *  - the trainer's player roster writes the summary as "Best Times: Mon 5-8pm, Wed 6-9pm" (prefix, compact ranges, no-times placeholder);
 *  - the parent's Best Times page has a "Profile" dropdown ("Me" + each child) to hop between grids without going back to Profiles.
 */
test.describe('US-01.09: Best Times roster prefix and profile switcher', () => {
  const addTime = (page: Page, index: number) => page.getByRole('button', { name: '+ Add time' }).nth(index).click();
  const switcher = (page: Page) => page.getByLabel('Profile', { exact: true });

  test('trainer roster: every summary starts with "Best Times:" in compact form; players without times show "No availability set"', async ({
    page,
    api,
    mailbox,
    narrate,
    loginAs,
  }) => {
    const trainer = await createTrainer(api, mailbox);
    const code = await createPlayerLinkCode(api, trainer);
    const evenings = await registerParent(api, code, { isSelf: true });
    const mixed = await registerParent(api, code, { isSelf: true });
    const nothing = await registerParent(api, code, { isSelf: true });
    await setPlayerAvailability(api, evenings.session, evenings.profiles[0].id, [
      { dayOfWeek: 3, startTime: minutes('18:00'), endTime: minutes('21:00') },
      { dayOfWeek: 1, startTime: minutes('17:00'), endTime: minutes('20:00') },
    ]);
    await setPlayerAvailability(api, mixed.session, mixed.profiles[0].id, [
      { dayOfWeek: 6, startTime: minutes('09:00'), endTime: minutes('12:00') },
      { dayOfWeek: 6, startTime: minutes('17:30'), endTime: minutes('19:00') },
      { dayOfWeek: 0, startTime: minutes('11:00'), endTime: minutes('13:30') },
    ]);

    await narrate('The trainer opens the Players roster');
    await loginAs(trainer.email, trainer.password);
    await shell(page).goTo('Players');
    const table = page.getByRole('table', { name: 'Player roster' });
    const row = (profile: { profiles: Array<{ name: string }> }) => table.getByRole('row', { name: profile.profiles[0].name });

    await narrate('Slots are ordered by weekday, and the summary begins with "Best Times:"');
    await expect(row(evenings)).toContainText('Best Times: Mon 5-8pm, Wed 6-9pm');
    await highlight(row(evenings));

    await narrate('Ranges crossing noon, half hours and several slots per day are written compactly');
    await expect(row(mixed)).toContainText('Best Times: Sun 11am-1:30pm, Sat 9am-12pm, Sat 5:30-7pm');
    await highlight(row(mixed));

    await narrate('A player who has not set Best Times shows a placeholder instead');
    await expect(row(nothing)).toContainText('No availability set');
    await expect(row(nothing)).not.toContainText('Best Times');
    await highlight(row(nothing));

    await narrate('The API returns the same string in the roster payload');
    const roster = await api.get<{ items: Array<{ name: string; availabilitySummary: string }> }>(`/trainers/${trainer.trainerId}/players`, { auth: trainer.session });
    expect(roster.status).toBe(200);
    const summaries = new Map(roster.body.items.map((i) => [i.name, i.availabilitySummary]));
    expect(summaries.get(evenings.profiles[0].name)).toBe('Best Times: Mon 5-8pm, Wed 6-9pm');
    expect(summaries.get(nothing.profiles[0].name)).toBe('');
  });

  test('profile switcher: "Me" and each child, switching navigates to that profile\'s own grid; saved times stay with their profile', async ({
    page,
    api,
    mailbox,
    narrate,
    loginAs,
  }) => {
    const trainer = await createTrainer(api, mailbox);
    const parent = await registerParent(api, await createPlayerLinkCode(api, trainer), { isSelf: true });
    const me = parent.profiles[0];
    const maya = await addChildProfile(api, parent, { name: `Maya ${uniqueName('Kid').lastName}`, trainerIds: [trainer.trainerId] });
    const leo = await addChildProfile(api, parent, { name: `Leo ${uniqueName('Kid').lastName}`, trainerIds: [trainer.trainerId] });
    await setPlayerAvailability(api, parent.session, leo.id, [{ dayOfWeek: 6, startTime: minutes('09:00'), endTime: minutes('12:00') }]);

    await narrate('The parent opens their own Best Times page');
    await loginAs(parent.email, parent.password);
    await page.goto(`/profiles/${me.id}/availability`);
    await expect(page.getByRole('heading', { name: 'Best Times', level: 1 })).toBeVisible();

    await narrate('A "Profile" dropdown lists "Me" and both children; "Me" is selected');
    await expect(switcher(page)).toBeVisible();
    await expect(switcher(page)).toHaveValue(me.id);
    const options = switcher(page).getByRole('option');
    expect(await options.allTextContents()).toEqual(expect.arrayContaining(['Me', maya.name, leo.name]));
    expect(await options.count()).toBe(3);
    await highlight(switcher(page));

    await narrate('Set Monday 5:00 PM - 8:00 PM for "Me" and save');
    await addTime(page, 1);
    await page.getByLabel('Mon start').fill('17:00');
    await page.getByLabel('Mon end').fill('20:00');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    const saved = page.getByRole('status').filter({ hasText: 'Availability saved.' });
    await expect(saved).toBeVisible();

    await narrate('Switch to Maya in the dropdown: URL changes, her grid is empty and the "saved" message is gone');
    await switcher(page).selectOption({ label: maya.name });
    await expect(page).toHaveURL(new RegExp(`/profiles/${maya.id}/availability$`));
    await expect(switcher(page)).toHaveValue(maya.id);
    await expect(page.getByLabel(/ start$/)).toHaveCount(0);
    await expect(page.getByRole('status').filter({ hasText: 'Availability saved.' })).toHaveCount(0);
    await highlight(switcher(page));

    await narrate('Switch to Leo: his Saturday morning slot (set earlier) is shown');
    await switcher(page).selectOption({ label: leo.name });
    await expect(page).toHaveURL(new RegExp(`/profiles/${leo.id}/availability$`));
    await expect(page.getByLabel('Sat start')).toHaveValue('09:00');
    await expect(page.getByLabel('Sat end')).toHaveValue('12:00');
    await expect(page.getByLabel('Mon start')).toHaveCount(0);

    await narrate('Back to "Me": Monday 5-8 PM was saved on the parent\'s own profile only');
    await switcher(page).selectOption({ label: 'Me' });
    await expect(page).toHaveURL(new RegExp(`/profiles/${me.id}/availability$`));
    await expect(page.getByLabel('Mon start')).toHaveValue('17:00');
    await expect(page.getByLabel('Mon end')).toHaveValue('20:00');
    await expect(page.getByLabel('Sat start')).toHaveCount(0);
    await highlight(page.getByLabel('Mon start'));

    await narrate('The browser back button returns to the previous profile in the switcher');
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`/profiles/${leo.id}/availability$`));
    await expect(switcher(page)).toHaveValue(leo.id);
  });

  test('profile switcher is hidden when the family has only one profile', async ({ page, api, mailbox, narrate, loginAs }) => {
    const trainer = await createTrainer(api, mailbox);
    const parent = await registerParent(api, await createPlayerLinkCode(api, trainer), { isSelf: false });
    expect(parent.profiles).toHaveLength(1);

    await narrate('A parent who only has one child profile: nothing to switch to');
    await loginAs(parent.email, parent.password);
    await page.goto(`/profiles/${parent.profiles[0].id}/availability`);
    await expect(page.getByRole('heading', { name: 'Best Times', level: 1 })).toBeVisible();
    await expect(page.getByRole('button', { name: '+ Add time' })).toHaveCount(7);
    await expect(switcher(page)).toHaveCount(0);
    await highlight(page.getByRole('heading', { name: 'Best Times', level: 1 }));

    await narrate('Adding a second child makes the dropdown appear');
    const second = await addChildProfile(api, parent, { name: `Zed ${uniqueName('Kid').lastName}`, trainerIds: [trainer.trainerId] });
    await page.reload();
    await expect(switcher(page)).toBeVisible();
    await expect(switcher(page).getByRole('option')).toHaveCount(2);
    await switcher(page).selectOption({ label: second.name });
    await expect(page).toHaveURL(new RegExp(`/profiles/${second.id}/availability$`));
  });
});
