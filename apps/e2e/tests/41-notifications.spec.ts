import type { Page } from '@playwright/test';

import {
  test,
  expect,
  highlight,
  shell,
  createTrainer,
  createCoach,
  createPlayerLinkCode,
  registerParent,
  addChildProfile,
  createChildLogin,
  uniqueName,
  type ApiClient,
  type ApiSession,
  type CoachFixture,
  type TrainerFixture,
} from '../support/test';

/**
 * In-app notifications (US-01.05 "email + in-app", US-01.10): a bell with an unread badge in the app-shell header opens a
 * popover list (GET /me/notifications). Choosing an item marks it read and follows its link; "Mark all as read" clears the
 * badge; with nothing to show the list says "You're all caught up".
 *  - parent: a pending child purchase; coach: an override nobody has answered; trainer: a coach's change request.
 */
test.describe('In-app notifications (bell)', () => {
  const bell = (page: Page) => page.getByRole('button', { name: /^Notifications/ });
  const badge = (page: Page) => page.getByTestId('notification-badge');
  const panel = (page: Page) => page.getByRole('region', { name: 'Notifications' });

  async function openBell(page: Page) {
    await bell(page).click();
    await expect(panel(page)).toBeVisible();
    return panel(page);
  }

  async function childRequest(api: ApiClient, session: ApiSession, title: string, amountCents: number) {
    const res = await api.post<{ id: string; status: string }>('/me/purchase-requests', {
      auth: session,
      body: { title, amountCents, paymentType: 'USD', currency: 'USD' },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
  }

  async function mondayEvening(api: ApiClient, coach: CoachFixture) {
    const res = await api.put(`/coaches/${coach.coachId}/availability`, {
      auth: coach.session,
      body: { slots: [{ dayOfWeek: 1, startTime: 16 * 60, endTime: 18 * 60, isAvailable: true }] },
    });
    expect(res.status, JSON.stringify(res.body)).toBeLessThan(300);
  }

  /** The trainer assigns the coach to a session outside their schedule (what the "Assign anyway" modal calls). */
  async function overrideCoach(api: ApiClient, trainer: TrainerFixture, coach: CoachFixture, sessionLabel: string, reason: string) {
    const res = await api.post(`/coaches/${coach.coachId}/availability/override`, {
      auth: trainer.session,
      body: { eventId: crypto.randomUUID(), reason, sessionLabel },
    });
    expect(res.status, JSON.stringify(res.body)).toBeLessThan(300);
  }

  async function unreadCount(api: ApiClient, session: ApiSession): Promise<number> {
    const res = await api.get<{ unreadCount: number }>('/me/notifications', { auth: session });
    expect(res.status).toBe(200);
    return res.body.unreadCount;
  }

  test('parent: a pending child purchase shows a bell badge; opening an item goes to /approvals and marks it read; "Mark all as read" clears the rest', async ({
    page,
    api,
    mailbox,
    narrate,
    loginAs,
  }) => {
    const trainer = await createTrainer(api, mailbox);
    const parent = await registerParent(api, await createPlayerLinkCode(api, trainer), { isSelf: true });
    const childName = `Nora ${uniqueName('Kid').lastName}`;
    const child = await addChildProfile(api, parent, { name: childName, trainerIds: [trainer.trainerId] });
    const login = await createChildLogin(api, parent, child);
    const camp = `Spring camp ${uniqueName('X').lastName}`;
    const shoes = `New shoes ${uniqueName('X').lastName}`;
    await childRequest(api, login.session, camp, 12000);
    await childRequest(api, login.session, shoes, 4500);

    await narrate('The parent signs in: the bell in the header shows 2 unread notifications');
    await loginAs(parent.email, parent.password);
    await expect(badge(page)).toHaveText('2');
    await expect(bell(page)).toHaveAccessibleName('Notifications, 2 unread');
    await highlight(bell(page));

    await narrate('Open the bell: one entry per pending request, newest first, unread ones in bold');
    const list = await openBell(page);
    await expect(list.getByRole('heading', { name: 'Notifications' })).toBeVisible();
    const shoesItem = list.getByRole('link', { name: new RegExp(shoes) });
    const campItem = list.getByRole('link', { name: new RegExp(camp) });
    await expect(shoesItem).toBeVisible();
    await expect(campItem).toBeVisible();
    await expect(shoesItem).toContainText(`${childName} needs your approval`);
    await expect(shoesItem).toContainText('(unread)');
    await highlight(list);

    await narrate('Choosing an entry takes the parent to the approvals page and marks it read');
    await shoesItem.click();
    await expect(page).toHaveURL(/\/approvals$/);
    await expect(panel(page)).toBeHidden();
    await expect(badge(page)).toHaveText('1');
    await expect(bell(page)).toHaveAccessibleName('Notifications, 1 unread');
    expect(await unreadCount(api, parent.session)).toBe(1);
    await highlight(badge(page));

    await narrate('Reopen: the opened entry is no longer unread, the other one still is');
    await openBell(page);
    await expect(panel(page).getByRole('link', { name: new RegExp(shoes) })).not.toContainText('(unread)');
    await expect(panel(page).getByRole('link', { name: new RegExp(camp) })).toContainText('(unread)');

    await narrate('"Mark all as read" clears the badge for good');
    await panel(page).getByRole('button', { name: 'Mark all as read' }).click();
    await expect(badge(page)).toHaveCount(0);
    await expect(bell(page)).toHaveAccessibleName('Notifications');
    await expect(panel(page).getByRole('button', { name: 'Mark all as read' })).toHaveCount(0);
    await expect(panel(page).getByRole('link', { name: new RegExp(camp) })).not.toContainText('(unread)');
    await highlight(panel(page));

    await narrate('The entries stay in the list (they are still pending) but after a reload the badge stays gone');
    await page.keyboard.press('Escape');
    await expect(panel(page)).toBeHidden();
    await page.reload();
    await expect(bell(page)).toBeVisible();
    await expect(badge(page)).toHaveCount(0);
    expect(await unreadCount(api, parent.session)).toBe(0);
    await openBell(page);
    await expect(panel(page).getByRole('link')).toHaveCount(2);
  });

  test('parent: nothing to do shows "You\'re all caught up"; resolving the request removes its notification', async ({ page, api, mailbox, narrate, loginAs }) => {
    const trainer = await createTrainer(api, mailbox);
    const parent = await registerParent(api, await createPlayerLinkCode(api, trainer), { isSelf: true });
    const childName = `Ivy ${uniqueName('Kid').lastName}`;
    const child = await addChildProfile(api, parent, { name: childName, trainerIds: [trainer.trainerId] });
    const login = await createChildLogin(api, parent, child);

    await narrate('A parent with no pending items: no badge on the bell');
    await loginAs(parent.email, parent.password);
    await expect(bell(page)).toBeVisible();
    await expect(badge(page)).toHaveCount(0);
    await expect(bell(page)).toHaveAccessibleName('Notifications');

    await narrate('The list says "You\'re all caught up"');
    const list = await openBell(page);
    await expect(list.getByText("You're all caught up")).toBeVisible();
    await expect(list.getByRole('link')).toHaveCount(0);
    await expect(list.getByRole('button', { name: 'Mark all as read' })).toHaveCount(0);
    await highlight(list);

    await narrate('Escape closes the popover and hands focus back to the bell');
    await page.keyboard.press('Escape');
    await expect(list).toBeHidden();
    await expect(bell(page)).toBeFocused();

    await narrate('The child asks for a purchase; after a refresh the parent has one unread notification');
    const title = `Tournament fee ${uniqueName('X').lastName}`;
    await childRequest(api, login.session, title, 3000);
    await page.reload();
    await expect(badge(page)).toHaveText('1');
    const open = await openBell(page);
    await expect(open.getByRole('link', { name: new RegExp(title) })).toBeVisible();

    await narrate('The parent approves the request on /approvals');
    await open.getByRole('link', { name: new RegExp(title) }).click();
    await expect(page).toHaveURL(/\/approvals$/);
    const card = page.getByRole('article', { name: childName });
    await card.getByRole('button', { name: 'Approve' }).click();
    const dialog = page.getByRole('dialog', { name: 'Approve request' });
    await dialog.getByRole('button', { name: 'Confirm approval' }).click();
    await expect(dialog).toBeHidden();

    await narrate('The decided request no longer needs attention: its notification is gone');
    await page.reload();
    await expect(bell(page)).toBeVisible();
    await expect(badge(page)).toHaveCount(0);
    const after = await openBell(page);
    await expect(after.getByText("You're all caught up")).toBeVisible();
    await expect(after.getByRole('link', { name: new RegExp(title) })).toHaveCount(0);
  });

  test('coach: an override nobody has answered shows up in the bell, links to My Times and disappears once accepted', async ({
    page,
    api,
    mailbox,
    narrate,
    loginAs,
  }) => {
    const trainer = await createTrainer(api, mailbox);
    const coach = await createCoach(api, mailbox, trainer);
    await mondayEvening(api, coach);
    const label = `Holiday camp ${uniqueName('X').lastName}`;
    await overrideCoach(api, trainer, coach, label, 'Another coach cancelled');

    await narrate('The coach signs in: the bell shows one unread notification');
    await loginAs(coach.email, coach.password);
    await expect(badge(page)).toHaveText('1');
    const list = await openBell(page);
    const item = list.getByRole('link', { name: new RegExp(label) });
    await expect(item).toContainText(`${trainer.businessName} scheduled you despite a conflict`);
    await expect(item).toContainText('Another coach cancelled');
    await highlight(item);

    await narrate('Choosing it opens My Times, where the override card waits for an answer');
    await item.click();
    await expect(page).toHaveURL(/\/my-times$/);
    await expect(badge(page)).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Schedule overrides' })).toBeVisible();
    await expect(page.getByText('Awaiting your response')).toBeVisible();

    await narrate('Accepting the assignment resolves it: the item leaves the list');
    await page.getByRole('button', { name: 'Accept' }).click();
    await expect(page.getByText('Accepted', { exact: true })).toBeVisible();
    await page.reload();
    await expect(bell(page)).toBeVisible();
    const after = await openBell(page);
    await expect(after.getByText("You're all caught up")).toBeVisible();
  });

  test('trainer: a coach\'s change request (and later the acceptance) appears in the trainer\'s bell and links to Coaches', async ({
    page,
    api,
    mailbox,
    narrate,
    loginAs,
  }) => {
    const trainer = await createTrainer(api, mailbox);
    const coach = await createCoach(api, mailbox, trainer);
    await mondayEvening(api, coach);
    const label = `Clinic ${uniqueName('X').lastName}`;
    await overrideCoach(api, trainer, coach, label, 'Short notice cover');
    const coachName = `${coach.firstName} ${coach.lastName}`;

    const overrides = await api.get<Array<{ id: string }>>(`/coaches/${coach.coachId}/availability/overrides`, { auth: coach.session });
    expect(overrides.status).toBe(200);
    const request = await api.post(`/coaches/${coach.coachId}/availability/overrides/${overrides.body[0].id}/request-change`, {
      auth: coach.session,
      body: { message: 'Could this move to Wednesday?' },
    });
    expect(request.status, JSON.stringify(request.body)).toBeLessThan(300);

    await narrate('The trainer signs in: the bell shows the coach\'s change request');
    await loginAs(trainer.email, trainer.password);
    await expect(badge(page)).toHaveText('1');
    const list = await openBell(page);
    const item = list.getByRole('link', { name: new RegExp(`${coachName} asked for a change`) });
    await expect(item).toContainText(label);
    await expect(item).toContainText('Could this move to Wednesday?');
    await highlight(item);

    await narrate('Choosing it opens the Coaches roster');
    await item.click();
    await expect(page).toHaveURL(/\/coaches$/);
    await expect(badge(page)).toHaveCount(0);
    expect(await unreadCount(api, trainer.session)).toBe(0);

    await narrate('The coach accepts the assignment anyway: the trainer gets a new "accepted" notification');
    const accepted = await api.post(`/coaches/${coach.coachId}/availability/overrides/${overrides.body[0].id}/acknowledge`, { auth: coach.session });
    expect(accepted.status, JSON.stringify(accepted.body)).toBeLessThan(300);
    await page.reload();
    await expect(badge(page)).toHaveText('1');
    const after = await openBell(page);
    await expect(after.getByRole('link', { name: new RegExp(`${coachName} accepted the assignment`) })).toBeVisible();
    await expect(after.getByRole('link', { name: new RegExp(`${coachName} asked for a change`) })).toHaveCount(0);
    await highlight(after);

    await narrate('Sign-out still works from this page');
    await page.keyboard.press('Escape');
    await shell(page).signOut();
    await expect(page).toHaveURL(/\/login/);
  });
});
