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
 * US-01.09 - Player / parent sets availability ("Best Times").
 * Parent: profile -> Best Times grid (several slots per day, validation, exact confirmation text, separate per child).
 * Trainer: roster shows each player's summary, can filter by day / time window with a "Players available at this time: X out of Y" count.
 * (There is no profile-switcher dropdown on the grid page: each child has their own Best Times page, opened from the profile.)
 */
test.describe('US-01.09: Player/Parent sets availability (Best Times)', () => {
  const DAY = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 } as const;

  /** "+ Add time" buttons are rendered once per weekday, Sunday first. */
  const addTime = (page: Page, day: keyof typeof DAY) => page.getByRole('button', { name: '+ Add time' }).nth(DAY[day]).click();

  test('parent sets Best Times per child: several slots per day, validation, saved message, separate per child; the trainer sees the summary', async ({
    page,
    api,
    mailbox,
    narrate,
    loginAs,
  }) => {
    const trainer = await createTrainer(api, mailbox);
    const parent = await registerParent(api, await createPlayerLinkCode(api, trainer), { isSelf: true });
    const maya = await addChildProfile(api, parent, { name: `Maya ${uniqueName('Kid').lastName}`, trainerIds: [trainer.trainerId] });
    const leo = await addChildProfile(api, parent, { name: `Leo ${uniqueName('Kid').lastName}`, trainerIds: [trainer.trainerId] });

    await narrate("The parent opens Maya's profile and clicks \"Best Times\"");
    await loginAs(parent.email, parent.password);
    await shell(page).goTo('Profiles');
    await page.getByRole('link', { name: maya.name }).click();
    await page.getByRole('link', { name: 'Best Times' }).click();
    await expect(page).toHaveURL(new RegExp(`/profiles/${maya.id}/availability$`));
    await expect(page.getByRole('heading', { name: 'Best Times', level: 1 })).toBeVisible();

    await narrate('A weekly grid: every day of the week can get one or more time ranges');
    await expect(page.getByRole('button', { name: '+ Add time' })).toHaveCount(7);
    await expect(page.getByLabel(/ start$/)).toHaveCount(0);
    await highlight(page.getByRole('button', { name: '+ Add time' }).first());

    await narrate('Monday 5:00 PM - 8:00 PM, then a second Monday slot, and Wednesday 6:00 PM - 9:00 PM');
    await addTime(page, 'Mon');
    await page.getByLabel('Mon start').first().fill('17:00');
    await page.getByLabel('Mon end').first().fill('20:00');
    await addTime(page, 'Mon');
    await expect(page.getByLabel('Mon start')).toHaveCount(2);
    await addTime(page, 'Wed');
    await page.getByLabel('Wed start').fill('18:00');
    await page.getByLabel('Wed end').fill('21:00');

    await narrate('The second Monday slot has an invalid range (start after end): saving is refused');
    await page.getByLabel('Mon start').nth(1).fill('21:00');
    await page.getByLabel('Mon end').nth(1).fill('20:30');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    const rangeError = page.getByRole('alert').filter({ hasText: 'Start time must be before end time.' });
    await expect(rangeError).toBeVisible();
    await highlight(rangeError);
    await expect(page.getByText('Availability saved.')).toHaveCount(0);

    await narrate('Remove that slot (a day can also be left empty = not available) and save');
    await page.getByRole('button', { name: 'Remove' }).nth(1).click();
    await expect(page.getByLabel('Mon start')).toHaveCount(1);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    const saved = page.getByRole('status').filter({ hasText: 'Availability saved. Trainers can see these preferences when planning sessions.' });
    await expect(saved).toBeVisible();
    await expect(saved).toHaveText('Availability saved. Trainers can see these preferences when planning sessions.');
    await highlight(saved);

    await narrate('Reload: the saved Best Times are still there');
    await page.reload();
    await expect(page.getByLabel('Mon start')).toHaveValue('17:00');
    await expect(page.getByLabel('Mon end')).toHaveValue('20:00');
    await expect(page.getByLabel('Wed start')).toHaveValue('18:00');
    await expect(page.getByLabel('Wed end')).toHaveValue('21:00');
    await expect(page.getByLabel('Tue start')).toHaveCount(0);

    await narrate("Switch to the other child (Leo): his Best Times are separate - still empty");
    await shell(page).goTo('Profiles');
    await page.getByRole('link', { name: leo.name }).click();
    await page.getByRole('link', { name: 'Best Times' }).click();
    await expect(page).toHaveURL(new RegExp(`/profiles/${leo.id}/availability$`));
    await expect(page.getByRole('heading', { name: 'Best Times', level: 1 })).toBeVisible();
    await expect(page.getByLabel(/ start$/)).toHaveCount(0);
    await addTime(page, 'Sat');
    await page.getByLabel('Sat start').fill('09:00');
    await page.getByLabel('Sat end').fill('12:00');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Availability saved.' })).toBeVisible();

    await narrate("Maya's times were not touched by Leo's");
    const mayaSlots = await api.get<{ slots: Array<{ dayOfWeek: number; startTime: number; endTime: number }> }>(`/player-profiles/${maya.id}/availability`, { auth: parent.session });
    expect(mayaSlots.body.slots.map((s) => [s.dayOfWeek, s.startTime, s.endTime])).toEqual([
      [1, minutes('17:00'), minutes('20:00')],
      [3, minutes('18:00'), minutes('21:00')],
    ]);

    await narrate("The trainer's player roster shows the summary for each player");
    await shell(page).signOut();
    await loginAs(trainer.email, trainer.password);
    await shell(page).goTo('Players');
    const table = page.getByRole('table', { name: 'Player roster' });
    const mayaRow = table.getByRole('row', { name: maya.name });
    await expect(mayaRow).toContainText('Mon 5-8pm, Wed 6-9pm');
    await expect(table.getByRole('row', { name: leo.name })).toContainText('Sat 9am-12pm');
    await expect(table.getByRole('row', { name: parent.profiles[0].name })).toContainText('No availability set');
    await highlight(mayaRow);
  });

  test('trainer filters players by day and time window and sees "Players available at this time: X out of Y"; empty state offers Clear filters', async ({
    page,
    api,
    mailbox,
    narrate,
    loginAs,
  }) => {
    const trainer = await createTrainer(api, mailbox);
    const code = await createPlayerLinkCode(api, trainer);
    const mondayEarly = await registerParent(api, code, { isSelf: true });
    const mondayLate = await registerParent(api, code, { isSelf: true });
    const wednesday = await registerParent(api, code, { isSelf: true });
    await setPlayerAvailability(api, mondayEarly.session, mondayEarly.profiles[0].id, [{ dayOfWeek: DAY.Mon, startTime: minutes('17:00'), endTime: minutes('20:00') }]);
    await setPlayerAvailability(api, mondayLate.session, mondayLate.profiles[0].id, [{ dayOfWeek: DAY.Mon, startTime: minutes('18:00'), endTime: minutes('21:00') }]);
    await setPlayerAvailability(api, wednesday.session, wednesday.profiles[0].id, [{ dayOfWeek: DAY.Wed, startTime: minutes('18:00'), endTime: minutes('21:00') }]);
    const names = [mondayEarly, mondayLate, wednesday].map((p) => p.profiles[0].name);
    const table = page.getByRole('table', { name: 'Player roster' });
    const count = page.getByRole('status').filter({ hasText: 'Players available at this time' });

    await narrate('The trainer opens Players: three players, each with their Best Times summary');
    await loginAs(trainer.email, trainer.password);
    await shell(page).goTo('Players');
    for (const name of names) await expect(table.getByRole('row', { name })).toBeVisible();
    await expect(table.getByRole('row', { name: names[0] })).toContainText('Mon 5-8pm');
    await expect(table.getByRole('row', { name: names[1] })).toContainText('Mon 6-9pm');
    await expect(table.getByRole('row', { name: names[2] })).toContainText('Wed 6-9pm');
    await expect(count).toHaveCount(0);

    await narrate('Filter: Monday');
    await page.getByLabel('Day').selectOption({ label: 'Mon' });
    await expect(count).toContainText('Players available at this time: 2 out of 3');
    await expect(table.getByRole('row', { name: names[2] })).toHaveCount(0);
    await highlight(count);

    await narrate('Narrow to Monday 5:00 PM - 6:00 PM: only the player available from 5 PM matches');
    await page.getByLabel('From', { exact: true }).fill('17:00');
    await page.getByLabel('To', { exact: true }).fill('18:00');
    await expect(count).toContainText('Players available at this time: 1 out of 3');
    await expect(table.getByRole('row', { name: names[0] })).toBeVisible();
    await expect(table.getByRole('row', { name: names[1] })).toHaveCount(0);
    await highlight(count);

    await narrate('Monday 6:00 PM - 8:00 PM: both Monday players are available');
    await page.getByLabel('From', { exact: true }).fill('18:00');
    await page.getByLabel('To', { exact: true }).fill('20:00');
    await expect(count).toContainText('Players available at this time: 2 out of 3');

    await narrate('Wednesday: just the Wednesday player');
    await page.getByLabel('Day').selectOption({ label: 'Wed' });
    await expect(count).toContainText('Players available at this time: 1 out of 3');
    await expect(table.getByRole('row', { name: names[2] })).toBeVisible();

    await narrate('Friday: nobody - empty state with "Clear filters"');
    await page.getByLabel('Day').selectOption({ label: 'Fri' });
    await expect(count).toContainText('Players available at this time: 0 out of 3');
    await expect(page.getByText('No players match this filter yet.')).toBeVisible();
    const clear = page.getByRole('button', { name: 'Clear filters' });
    await highlight(clear);
    await clear.click();

    await narrate('Filters cleared: everybody is listed again');
    for (const name of names) await expect(table.getByRole('row', { name })).toBeVisible();
    await expect(count).toHaveCount(0);
    await expect(page.getByLabel('Day')).toHaveValue('');

    await narrate('The small "Clear" button of the filter bar resets filters too');
    await page.getByLabel('Day').selectOption({ label: 'Mon' });
    await expect(count).toContainText('2 out of 3');
    await page.getByRole('button', { name: 'Clear', exact: true }).click();
    await expect(count).toHaveCount(0);
    await expect(table.getByRole('row', { name: names[2] })).toBeVisible();
  });
});
