import type { Page } from '@playwright/test';

import {
  test,
  expect,
  highlight,
  shell,
  showEmail,
  createTrainer,
  createCoach,
  nextDateOnWeekday,
  uniqueName,
  type ApiClient,
  type CoachFixture,
  type TrainerFixture,
} from '../support/test';

/**
 * US-01.10 follow-up: when the trainer assigns a coach despite a conflict, the coach can "Accept" the assignment or
 * "Request change" (a message of 5-500 characters). The trainer then sees a "Change requested" badge on the Coaches roster,
 * gets an email and an in-app notification; "Edit request" re-sends; accepting afterwards closes the request.
 */
test.describe('US-01.10: Coach requests a change to an override assignment', () => {
  const MONDAY = 1;

  async function setMondayEvening(api: ApiClient, coach: CoachFixture) {
    const res = await api.put(`/coaches/${coach.coachId}/availability`, {
      auth: coach.session,
      body: { slots: [{ dayOfWeek: MONDAY, startTime: 16 * 60, endTime: 18 * 60, isAvailable: true }] },
    });
    expect(res.status, JSON.stringify(res.body)).toBeLessThan(300);
  }

  /** Trainer UI: Coaches -> "Check availability / Assign" -> conflicting time -> reason -> "Assign anyway". */
  async function trainerOverridesThroughUi(
    page: Page,
    trainer: TrainerFixture,
    coach: CoachFixture,
    label: string,
    reason: string,
    loginAs: (e: string, p: string) => Promise<void>,
  ) {
    await loginAs(trainer.email, trainer.password);
    await shell(page).goTo('Coaches');
    const row = page.getByRole('table', { name: 'Coach roster' }).getByRole('row').filter({ hasText: coach.email });
    await row.getByRole('button', { name: /^Check availability \/ Assign .* to session$/ }).click();
    const dialog = page.getByRole('dialog', { name: `Assign ${coach.firstName} ${coach.lastName} to a session` });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('Session label (optional)').fill(label);
    await dialog.getByLabel('Session date').fill(nextDateOnWeekday(MONDAY));
    await dialog.getByLabel('Start time').fill('10:00');
    await dialog.getByLabel('End time').fill('11:00');
    await dialog.getByRole('button', { name: 'Check availability' }).click();
    await dialog.getByLabel('Reason for assigning anyway').fill(reason);
    await dialog.getByRole('button', { name: 'Assign anyway' }).click();
    await expect(dialog).toBeHidden();
  }

  const coachRow = (page: Page, coach: CoachFixture) => page.getByRole('table', { name: 'Coach roster' }).getByRole('row').filter({ hasText: coach.email });

  test('trainer overrides a conflict -> coach requests a change (validation, Escape, send) -> trainer sees the badge, the email and a notification', async ({
    page,
    api,
    mailbox,
    narrate,
    loginAs,
  }) => {
    const trainer = await createTrainer(api, mailbox);
    const coach = await createCoach(api, mailbox, trainer);
    await setMondayEvening(api, coach);
    const coachName = `${coach.firstName} ${coach.lastName}`;
    const label = `Morning clinic ${uniqueName('X').lastName}`;
    const reason = 'Our other coach is ill';
    const message = 'I teach on Monday mornings - could this move to the afternoon?';

    await narrate('Trainer assigns the coach to a Monday 10:00 session outside their schedule ("Assign anyway")');
    await trainerOverridesThroughUi(page, trainer, coach, label, reason, loginAs);
    await expect(page.getByRole('status').filter({ hasText: `${coachName} was assigned anyway.` })).toBeVisible();
    await expect(coachRow(page, coach)).not.toContainText('Change requested');
    await shell(page).signOut();

    await narrate('The coach signs in and opens My Times: the override card asks to Accept or Request change');
    await loginAs(coach.email, coach.password);
    await shell(page).goTo('My Times');
    await expect(page.getByText(`${trainer.businessName}: ${reason}`)).toBeVisible();
    await expect(page.getByText('Awaiting your response')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Accept' })).toBeVisible();
    const requestButton = page.getByRole('button', { name: 'Request change' });
    await highlight(requestButton);

    await narrate('"Request change" opens a dialog; sending it empty is refused');
    await requestButton.click();
    const dialog = page.getByRole('dialog', { name: 'Request a change' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel('Message')).toBeFocused();
    await dialog.getByRole('button', { name: 'Send request' }).click();
    const tooShort = dialog.getByRole('alert').filter({ hasText: 'Please write at least 5 characters.' });
    await expect(tooShort).toBeVisible();
    await highlight(tooShort);

    await narrate('A 3-character message is still too short');
    await dialog.getByLabel('Message').fill('Nop');
    await dialog.getByRole('button', { name: 'Send request' }).click();
    await expect(dialog.getByRole('alert').filter({ hasText: 'Please write at least 5 characters.' })).toBeVisible();

    await narrate('Escape closes the dialog, nothing was sent, and focus goes back to the button that opened it');
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(requestButton).toBeFocused();
    await expect(page.getByText('Awaiting your response')).toBeVisible();

    await narrate('Open it again and send a real message');
    await requestButton.click();
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('Message').fill(message);
    await dialog.getByRole('button', { name: 'Send request' }).click();
    await expect(dialog).toBeHidden();
    const toast = page.getByRole('status').filter({ hasText: 'Your request was sent to your trainer.' });
    await expect(toast).toBeVisible();
    await highlight(toast);

    await narrate('The card now says "Change requested", shows the coach\'s message and offers "Edit request"');
    await expect(page.getByText('Change requested', { exact: true })).toBeVisible();
    await expect(page.getByText(`Your request: ${message}`)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Edit request' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Accept' })).toBeVisible();
    await highlight(page.getByText(`Your request: ${message}`));

    await narrate('The trainer receives an email with the coach\'s message');
    const mail = await mailbox.waitFor(trainer.email, { subject: `${coachName} asked you to change an assignment` });
    expect(mail.text + mail.html).toContain(message);
    expect(mail.links.some((l) => /\/coaches$/.test(l)), JSON.stringify(mail.links)).toBe(true);
    await showEmail(page, mail, 2200);

    await narrate('The trainer signs in: the bell has a notification and the Coaches roster shows a "Change requested" badge');
    await loginAs(trainer.email, trainer.password);
    await expect(page.getByTestId('notification-badge')).toHaveText('1');
    await shell(page).goTo('Coaches');
    const badge = coachRow(page, coach).getByText('Change requested');
    await expect(badge).toBeVisible();
    await expect(coachRow(page, coach)).toContainText(message);
    await highlight(badge);
  });

  test('"Edit request" re-sends a new message to the trainer; Cancel sends nothing', async ({ page, api, mailbox, narrate, loginAs }) => {
    const trainer = await createTrainer(api, mailbox);
    const coach = await createCoach(api, mailbox, trainer);
    await setMondayEvening(api, coach);
    const coachName = `${coach.firstName} ${coach.lastName}`;
    const label = `Evening drill ${uniqueName('X').lastName}`;
    const first = 'Please move this to Tuesday';
    const second = 'Actually Wednesday works better for me';
    const override = await api.post(`/coaches/${coach.coachId}/availability/override`, {
      auth: trainer.session,
      body: { eventId: crypto.randomUUID(), reason: 'Cover needed', sessionLabel: label },
    });
    expect(override.status, JSON.stringify(override.body)).toBeLessThan(300);

    await narrate('The coach requests a change');
    await loginAs(coach.email, coach.password);
    await shell(page).goTo('My Times');
    await page.getByRole('button', { name: 'Request change' }).click();
    const dialog = page.getByRole('dialog', { name: 'Request a change' });
    await expect(dialog.getByText(`about "${label}"`)).toBeVisible();
    await dialog.getByLabel('Message').fill(first);
    await dialog.getByRole('button', { name: 'Send request' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText(`Your request: ${first}`)).toBeVisible();

    await narrate('Edit request -> Cancel leaves the first message in place');
    await page.getByRole('button', { name: 'Edit request' }).click();
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('Message').fill('this will not be sent');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText(`Your request: ${first}`)).toBeVisible();

    await narrate('Edit request -> a new message replaces the old one');
    await page.getByRole('button', { name: 'Edit request' }).click();
    await dialog.getByLabel('Message').fill(second);
    await dialog.getByRole('button', { name: 'Send request' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText(`Your request: ${second}`)).toBeVisible();
    await expect(page.getByText(`Your request: ${first}`)).toHaveCount(0);
    await highlight(page.getByText(`Your request: ${second}`));

    await narrate('The trainer got two emails (first and second request) and nothing for the cancelled draft');
    await mailbox.waitFor(trainer.email, { subject: `${coachName} asked you to change an assignment`, timeoutMs: 20_000 });
    await expect
      .poll(async () => (await mailbox.list(trainer.email)).filter((m) => m.subject.includes('asked you to change an assignment')).length, { timeout: 20_000 })
      .toBe(2);
    const bodies = (await mailbox.list(trainer.email)).map((m) => m.text + m.html).join('\n');
    expect(bodies).toContain(first);
    expect(bodies).toContain(second);
    expect(bodies).not.toContain('this will not be sent');

    await narrate('On the roster only the latest message is shown');
    await shell(page).signOut();
    await loginAs(trainer.email, trainer.password);
    await shell(page).goTo('Coaches');
    const row = coachRow(page, coach);
    await expect(row.getByText('Change requested')).toBeVisible();
    await expect(row).toContainText(second);
    await expect(row).not.toContainText(first);
  });

  test('"Accept" instead: the coach accepts, the trainer\'s badge disappears, request buttons go away and a late request is refused', async ({
    page,
    api,
    mailbox,
    narrate,
    loginAs,
  }) => {
    const trainer = await createTrainer(api, mailbox);
    const coach = await createCoach(api, mailbox, trainer);
    await setMondayEvening(api, coach);
    const label = `Camp day ${uniqueName('X').lastName}`;
    const override = await api.post(`/coaches/${coach.coachId}/availability/override`, {
      auth: trainer.session,
      body: { eventId: crypto.randomUUID(), reason: 'Emergency cover', sessionLabel: label },
    });
    expect(override.status, JSON.stringify(override.body)).toBeLessThan(300);
    const list = await api.get<Array<{ id: string }>>(`/coaches/${coach.coachId}/availability/overrides`, { auth: coach.session });
    const overrideId = list.body[0].id;
    const asked = await api.post(`/coaches/${coach.coachId}/availability/overrides/${overrideId}/request-change`, {
      auth: coach.session,
      body: { message: 'Is there any other day possible?' },
    });
    expect(asked.status).toBeLessThan(300);

    await narrate('The trainer sees the open change request on the roster');
    await loginAs(trainer.email, trainer.password);
    await shell(page).goTo('Coaches');
    await expect(coachRow(page, coach).getByText('Change requested')).toBeVisible();
    await shell(page).signOut();

    await narrate('The coach changes their mind and presses "Accept"');
    await loginAs(coach.email, coach.password);
    await shell(page).goTo('My Times');
    await expect(page.getByText('Change requested', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Accept' }).click();
    await expect(page.getByText('Accepted', { exact: true })).toBeVisible();
    await expect(page.getByText('Change requested', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Accept' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Request change' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Edit request' })).toHaveCount(0);
    await highlight(page.getByText('Accepted', { exact: true }));

    await narrate('A change request after acceptance is refused by the API (409)');
    const late = await api.post(`/coaches/${coach.coachId}/availability/overrides/${overrideId}/request-change`, {
      auth: coach.session,
      body: { message: 'Too late to ask?' },
    });
    expect(late.status).toBe(409);
    expect(JSON.stringify(late.body)).toContain('OVERRIDE_ALREADY_ACKNOWLEDGED');

    await narrate('The trainer\'s roster no longer shows "Change requested"');
    await shell(page).signOut();
    await loginAs(trainer.email, trainer.password);
    await shell(page).goTo('Coaches');
    await expect(coachRow(page, coach)).toBeVisible();
    await expect(coachRow(page, coach).getByText('Change requested')).toHaveCount(0);
    await highlight(coachRow(page, coach));
  });

  test('only the coach themselves can request a change on their override (other coach / trainer get 404 or 403)', async ({ page, api, mailbox, narrate, loginAs }) => {
    const trainer = await createTrainer(api, mailbox);
    const coach = await createCoach(api, mailbox, trainer);
    const other = await createCoach(api, mailbox, trainer);
    await setMondayEvening(api, coach);
    await loginAs(coach.email, coach.password);
    await shell(page).goTo('My Times');
    await narrate('API check (the override card is on screen): ownership of the override is enforced');
    const override = await api.post(`/coaches/${coach.coachId}/availability/override`, {
      auth: trainer.session,
      body: { eventId: crypto.randomUUID(), reason: 'Cover needed', sessionLabel: 'Ownership check' },
    });
    expect(override.status).toBeLessThan(300);
    const list = await api.get<Array<{ id: string }>>(`/coaches/${coach.coachId}/availability/overrides`, { auth: coach.session });
    const path = `/coaches/${coach.coachId}/availability/overrides/${list.body[0].id}/request-change`;

    const byOther = await api.post(path, { auth: other.session, body: { message: 'Not my override' } });
    expect([403, 404]).toContain(byOther.status);
    const byTrainer = await api.post(path, { auth: trainer.session, body: { message: 'Trainer cannot ask themselves' } });
    expect([403, 404]).toContain(byTrainer.status);
    const tooShort = await api.post(path, { auth: coach.session, body: { message: 'no' } });
    expect(tooShort.status).toBe(400);
    const tooLong = await api.post(path, { auth: coach.session, body: { message: 'x'.repeat(501) } });
    expect(tooLong.status).toBe(400);
    const ok = await api.post(path, { auth: coach.session, body: { message: 'x'.repeat(500) } });
    expect(ok.status).toBeLessThan(300);

    await narrate('After a reload the card shows the request');
    await page.reload();
    await expect(page.getByText('Change requested', { exact: true })).toBeVisible();
    await highlight(page.getByText('Change requested', { exact: true }));
  });
});
