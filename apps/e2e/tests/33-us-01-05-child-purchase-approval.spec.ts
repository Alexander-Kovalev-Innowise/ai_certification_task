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
  createChildLogin,
  expirePendingApprovals,
  showEmail,
  strongPassword,
  uniqueEmail,
  uniqueName,
  type ApiClient,
  type ApiSession,
  type ParentFixture,
  type ProfileSummary,
} from '../support/test';

/**
 * US-01.05 - A child's purchase needs the parent's approval.
 * Parent creates the child's own login -> child signs in and asks for a purchase (USD: always pending; tokens: pending unless the
 * parent allowed token spending) -> parent is notified (email + dashboard count + /approvals) and approves / denies / asks for info
 * (with notes) -> child sees the new status (+ email). Pending requests expire after 48h.
 */
test.describe('US-01.05: Child purchase requires parent approval', () => {
  /** A parent with one child that already has its own login (API arrange) and one trainer. */
  async function family(api: ApiClient, mailbox: Parameters<typeof createTrainer>[1], childLabel = 'Sam') {
    const trainer = await createTrainer(api, mailbox);
    const parent = await registerParent(api, await createPlayerLinkCode(api, trainer), { isSelf: true });
    const childName = `${childLabel} ${uniqueName('Kid').lastName}`;
    const child = await addChildProfile(api, parent, { name: childName, trainerIds: [trainer.trainerId] });
    const login = await createChildLogin(api, parent, child);
    return { trainer, parent, child, login };
  }

  async function childRequest(api: ApiClient, session: ApiSession, body: { title: string; amountCents: number; paymentType: 'USD' | 'TOKENS' }) {
    const res = await api.post<{ id: string; status: string }>('/me/purchase-requests', {
      auth: session,
      body: { ...body, currency: body.paymentType === 'USD' ? 'USD' : 'TOKENS' },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body;
  }

  /** The child's UI form: "My requests" -> "New request". */
  async function askParent(page: Page, narrate: (t: string) => Promise<void>, req: { title: string; amount: string; pay: 'USD' | 'Tokens' }) {
    await shell(page).goTo('My requests');
    await expect(page.getByRole('heading', { name: 'My requests', level: 1 })).toBeVisible();
    await narrate(`The child clicks "New request": ${req.title}, ${req.amount} ${req.pay}`);
    await page.getByRole('button', { name: 'New request' }).click();
    const dialog = page.getByRole('dialog', { name: 'New request' });
    await dialog.getByLabel('What is it for?').fill(req.title);
    await dialog.getByLabel('Amount').fill(req.amount);
    await dialog.getByLabel('Pay with').selectOption({ label: req.pay });
    await dialog.getByRole('button', { name: 'Send request' }).click();
    await expect(dialog).toBeHidden();
  }

  const requestItem = (page: Page, title: string) => page.getByRole('list', { name: 'My requests' }).getByRole('listitem').filter({ hasText: title });
  const approvalCard = (page: Page, childName: string) => page.getByRole('article', { name: childName });

  test('parent creates the child\'s own login in the UI (validation, duplicate email) and the child signs in', async ({ page, api, mailbox, narrate, loginAs }) => {
    const trainer = await createTrainer(api, mailbox);
    const parent: ParentFixture = await registerParent(api, await createPlayerLinkCode(api, trainer), { isSelf: true });
    const childName = `Tessa ${uniqueName('Kid').lastName}`;
    const child: ProfileSummary = await addChildProfile(api, parent, { name: childName, trainerIds: [trainer.trainerId] });
    const takenEmail = parent.email;
    const childEmail = uniqueEmail('tessa');
    const childPassword = strongPassword();

    await narrate('The parent opens the child\'s profile: a "Child login" card offers the child their own sign-in');
    await loginAs(parent.email, parent.password);
    await page.goto(`/profiles/${child.id}`);
    const card = page.getByRole('region', { name: 'Child login' }).or(page.locator('[aria-label="Child login"]'));
    await expect(card.getByRole('heading', { name: 'Child login' })).toBeVisible();
    await expect(card.getByText(`Give ${childName} their own sign-in`, { exact: false })).toBeVisible();

    await narrate('Validation: valid email and a strong password are required');
    await card.getByRole('button', { name: 'Create login' }).click();
    await expect(card.getByText('Email is required.')).toBeVisible();
    await expect(card.getByText('Password must be at least 8 characters.')).toBeVisible();
    await card.getByLabel("Child's sign-in email").fill(takenEmail);
    await card.getByLabel('Initial password').fill(childPassword);
    await card.getByRole('button', { name: 'Create login' }).click();
    await narrate('Email uniqueness: an address that already belongs to another account is refused');
    const dup = card.getByRole('alert').filter({ hasText: 'A user with this email already exists, or this child already has a login.' });
    await expect(dup).toBeVisible();
    await highlight(dup);

    await narrate('A fresh e-mail address works');
    await card.getByLabel("Child's sign-in email").fill(childEmail);
    await card.getByRole('button', { name: 'Create login' }).click();
    await expect(card.getByText(`${childName} can sign in with their own account. Purchases they request need your approval.`)).toBeVisible();
    await expect(card.getByRole('button', { name: 'Reset password' })).toBeVisible();
    await highlight(card);

    await narrate('The parent can later reset the child\'s password');
    await card.getByLabel('New password').fill(childPassword);
    await card.getByRole('button', { name: 'Reset password' }).click();
    await expect(card.getByRole('status').filter({ hasText: 'Password updated. Your child has been signed out everywhere.' })).toBeVisible();

    await narrate('The child signs in with their own login and lands on a child portal');
    await shell(page).signOut();
    await loginAs(childEmail, childPassword);
    await expect(page.getByRole('heading', { name: new RegExp(`^Welcome, ${childName.split(' ')[0]}`) })).toBeVisible();
    await expect(page.getByTestId('context-switcher-current')).toHaveText(trainer.businessName);
    await expect(shell(page).navLink('My requests')).toBeVisible();
    await expect(shell(page).navLink('Approvals')).toHaveCount(0);
    await highlight(shell(page).sidebar);
  });

  test('USD request: Pending Parent Approval -> parent is notified (email, count, Approvals page) and approves with a note -> child sees Confirmed', async ({
    page,
    api,
    mailbox,
    narrate,
    loginAs,
  }) => {
    const { parent, child, login } = await family(api, mailbox);
    const title = `Saturday skills clinic ${uniqueName('X').lastName}`;

    await narrate('The child signs in and asks for a USD purchase');
    await loginAs(login.email, login.password);
    await askParent(page, narrate, { title, amount: '25.00', pay: 'USD' });
    const mine = requestItem(page, title);
    await expect(mine.getByText('Pending Parent Approval')).toBeVisible();
    await expect(mine.getByText('$25.00')).toBeVisible();
    await highlight(mine);

    await narrate('The parent receives an email asking for approval');
    const mail = await mailbox.waitFor(parent.email, { subject: `${child.name} is asking for your approval` });
    expect(mail.text).toContain('$25.00');
    expect(mail.links[0]).toMatch(/\/approvals$/);

    await narrate('The parent signs in: the dashboard counts the pending approval');
    await shell(page).signOut();
    await loginAs(parent.email, parent.password);
    const stat = page.getByRole('link', { name: /Pending Approvals/ });
    await expect(stat).toContainText('1');
    await highlight(stat);
    await showEmail(page, mail, 1800);
    await page.goto('/approvals');

    await narrate('Approvals page: who, how much, what for, and a 48h countdown');
    const card = approvalCard(page, child.name);
    await expect(card).toContainText('25 USD');
    await expect(card).toContainText(title);
    await expect(card.getByTestId('approval-countdown')).toContainText(/4[78]h \d+m remaining/);
    await highlight(card);

    await narrate('Approve with a note');
    await card.getByRole('button', { name: 'Approve' }).click();
    const dialog = page.getByRole('dialog', { name: 'Approve request' });
    await dialog.getByLabel('Notes (optional)').fill('Sounds good - have fun!');
    await dialog.getByRole('button', { name: 'Confirm approval' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText("No pending approvals — you're all caught up.")).toBeVisible();
    await page.getByText('Recently resolved (last 7 days)').click();
    const resolved = approvalCard(page, child.name);
    await expect(resolved).toContainText('APPROVED');
    await expect(resolved).toContainText('Sounds good - have fun!');
    await highlight(resolved);

    await narrate('The child sees the status change from Pending to Confirmed, with the parent\'s note');
    await shell(page).signOut();
    await loginAs(login.email, login.password);
    await shell(page).goTo('My requests');
    const done = requestItem(page, title);
    await expect(done.getByText('Confirmed')).toBeVisible();
    await expect(done.getByText('Pending Parent Approval')).toHaveCount(0);
    await expect(done.getByText('Note from your parent: Sounds good - have fun!')).toBeVisible();
    await highlight(done);

    await narrate('...and gets an email about the decision');
    const childMail = await mailbox.waitFor(login.email, { subject: 'Your purchase request was approved' });
    expect(childMail.text).toContain('Sounds good - have fun!');
    await showEmail(page, childMail, 1800);
  });

  test('parent denies a request with a note: the child sees Denied, the note and gets an email', async ({ page, api, mailbox, narrate, loginAs }) => {
    const { parent, child, login } = await family(api, mailbox, 'Dana');
    const title = `Expensive camp ${uniqueName('X').lastName}`;
    await childRequest(api, login.session, { title, amountCents: 40000, paymentType: 'USD' });

    await narrate('The parent opens the pending request and denies it with a note');
    await loginAs(parent.email, parent.password);
    await page.goto('/approvals');
    const card = approvalCard(page, child.name);
    await expect(card).toContainText('400 USD');
    await card.getByRole('button', { name: 'Deny' }).click();
    const dialog = page.getByRole('dialog', { name: 'Deny request' });
    await dialog.getByLabel('Notes (optional)').fill('Too expensive this month.');
    await dialog.getByRole('button', { name: 'Confirm denial' }).click();
    await expect(dialog).toBeHidden();
    await page.getByText('Recently resolved (last 7 days)').click();
    await expect(approvalCard(page, child.name)).toContainText('DENIED');
    await expect(approvalCard(page, child.name)).toContainText('Too expensive this month.');
    await highlight(approvalCard(page, child.name));

    await narrate('The child sees Denied with the parent\'s note');
    await shell(page).signOut();
    await loginAs(login.email, login.password);
    await shell(page).goTo('My requests');
    const item = requestItem(page, title);
    await expect(item.getByText('Denied', { exact: true })).toBeVisible();
    await expect(item.getByText('Note from your parent: Too expensive this month.')).toBeVisible();
    await highlight(item);

    await narrate('The child is notified by email');
    const mail = await mailbox.waitFor(login.email, { subject: 'Your purchase request was denied' });
    expect(mail.text).toContain('Too expensive this month.');
    await showEmail(page, mail, 1800);
  });

  test('"Request info" keeps the request pending and emails the child; the parent can approve afterwards', async ({ page, api, mailbox, narrate, loginAs }) => {
    const { parent, child, login } = await family(api, mailbox, 'Ines');
    const title = `Mystery clinic ${uniqueName('X').lastName}`;
    await childRequest(api, login.session, { title, amountCents: 1500, paymentType: 'USD' });

    await narrate('The parent asks the child a question instead of deciding');
    await loginAs(parent.email, parent.password);
    await page.goto('/approvals');
    const card = approvalCard(page, child.name);
    await card.getByRole('button', { name: 'Request info' }).click();
    const dialog = page.getByRole('dialog', { name: 'Request more info' });
    await dialog.getByRole('button', { name: 'Send question' }).click();
    await expect(dialog.getByText('Write a short question for your child.')).toBeVisible();
    await dialog.getByLabel('Your question').fill('Which clinic is this for?');
    await dialog.getByRole('button', { name: 'Send question' }).click();
    await expect(dialog).toBeHidden();

    await narrate('The request stays pending and shows the question');
    await expect(approvalCard(page, child.name)).toContainText('You asked: Which clinic is this for?');
    await expect(approvalCard(page, child.name).getByRole('button', { name: 'Approve' })).toBeVisible();
    await highlight(approvalCard(page, child.name));

    await narrate('The child receives the question by email and sees it next to the pending request');
    const mail = await mailbox.waitFor(login.email, { subject: 'Your parent needs more information about your request' });
    expect(mail.text).toContain('Which clinic is this for?');
    await shell(page).signOut();
    await loginAs(login.email, login.password);
    await shell(page).goTo('My requests');
    const item = requestItem(page, title);
    await expect(item.getByText('Pending Parent Approval')).toBeVisible();
    await expect(item.getByText('Your parent asked: Which clinic is this for?')).toBeVisible();
    await highlight(item);
    await showEmail(page, mail, 1800);

    await narrate('After the answer the parent approves');
    await page.goto('/login');
    await loginAs(parent.email, parent.password);
    await page.goto('/approvals');
    await approvalCard(page, child.name).getByRole('button', { name: 'Approve' }).click();
    await page.getByRole('dialog', { name: 'Approve request' }).getByRole('button', { name: 'Confirm approval' }).click();
    await expect(page.getByText("No pending approvals — you're all caught up.")).toBeVisible();
  });

  test('token spending: setting OFF (default) needs approval; ON spends instantly and only informs the parent; the setting is per child', async ({
    page,
    api,
    mailbox,
    narrate,
    loginAs,
  }) => {
    const { trainer, parent, child, login } = await family(api, mailbox, 'Theo');
    const sibling = await addChildProfile(api, parent, { name: `Pia ${uniqueName('Kid').lastName}`, trainerIds: [trainer.trainerId] });
    const siblingLogin = await createChildLogin(api, parent, sibling);
    const offTitle = `Token pack OFF ${uniqueName('X').lastName}`;
    const onTitle = `Token pack ON ${uniqueName('X').lastName}`;

    await narrate('Default (setting OFF): a token request is pending, exactly like a USD payment');
    await loginAs(login.email, login.password);
    await askParent(page, narrate, { title: offTitle, amount: '5', pay: 'Tokens' });
    await expect(requestItem(page, offTitle).getByText('Pending Parent Approval')).toBeVisible();
    await expect(requestItem(page, offTitle).getByText('5.00 tokens')).toBeVisible();
    await highlight(requestItem(page, offTitle));

    await narrate('The parent turns on "Allow this player to spend tokens without approval" in the child\'s profile');
    await shell(page).signOut();
    await loginAs(parent.email, parent.password);
    await page.goto(`/profiles/${child.id}`);
    const allow = page.getByLabel('Allow this player to spend tokens without approval');
    await expect(allow).not.toBeChecked();
    await allow.check();
    await highlight(allow);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect.poll(async () => (await api.get<{ allowChildTokenSpendWithoutApproval: boolean }>(`/player-profiles/${child.id}`, { auth: parent.session })).body.allowChildTokenSpendWithoutApproval).toBe(true);
    await page.reload();
    await expect(page.getByLabel('Allow this player to spend tokens without approval')).toBeChecked();

    await narrate('Now the child\'s token request is confirmed immediately');
    await shell(page).signOut();
    await loginAs(login.email, login.password);
    await askParent(page, narrate, { title: onTitle, amount: '3', pay: 'Tokens' });
    const instant = requestItem(page, onTitle);
    await expect(instant.getByText('Confirmed')).toBeVisible();
    await expect(instant.getByText('3.00 tokens')).toBeVisible();
    await highlight(instant);

    await narrate('A USD request of the same child still needs approval');
    await askParent(page, narrate, { title: `USD still pending ${uniqueName('X').lastName}`, amount: '10', pay: 'USD' });
    await expect(page.getByRole('list', { name: 'My requests' }).getByText('Pending Parent Approval')).toHaveCount(2);

    await narrate('The parent got an informational email (no approval needed) and only the older requests are pending');
    const notice = await mailbox.waitFor(parent.email, { subject: `${child.name} spent tokens (no approval needed)` });
    expect(notice.text).toContain('3.00 tokens');
    expect(notice.text).toContain('no approval was needed');
    await shell(page).signOut();
    await loginAs(parent.email, parent.password);
    await page.goto('/approvals');
    await expect(approvalCard(page, child.name)).toHaveCount(2);
    await expect(page.getByText(onTitle)).toHaveCount(0);
    await showEmail(page, notice, 1800);

    await narrate('The setting is per child: the sibling\'s token request still needs approval');
    await page.goto('/login');
    await loginAs(siblingLogin.email, siblingLogin.password);
    await askParent(page, narrate, { title: `Sibling tokens ${uniqueName('X').lastName}`, amount: '2', pay: 'Tokens' });
    await expect(page.getByRole('list', { name: 'My requests' }).getByText('Pending Parent Approval')).toHaveCount(1);
  });

  test('a pending request expires after 48 hours: it is auto-expired (no response) and parent and child are told', async ({ page, api, mailbox, narrate, loginAs }) => {
    test.setTimeout(480_000);
    const { parent, child, login } = await family(api, mailbox, 'Uma');
    const title = `Forgotten request ${uniqueName('X').lastName}`;
    const created = await childRequest(api, login.session, { title, amountCents: 2000, paymentType: 'USD' });
    const statusOf = async () => {
      const res = await api.get<{ items: Array<{ id: string; status: string }> }>('/approvals', { auth: parent.session });
      return res.body.items.find((i) => i.id === created.id)?.status;
    };
    expect(await statusOf()).toBe('PENDING');

    await narrate('48 hours pass without an answer (the request is aged in the e2e database)');
    expect(await expirePendingApprovals(child.id)).toBe(1);
    await loginAs(parent.email, parent.password);
    await page.goto('/approvals');
    await expect(approvalCard(page, child.name).getByTestId('approval-countdown')).toHaveText('Expiring…');
    await highlight(approvalCard(page, child.name));

    await narrate('The ApprovalExpiryJob (runs every 5 minutes) sweeps the request to EXPIRED - waiting for the next run...');
    await expect.poll(statusOf, { timeout: 360_000, intervals: [5_000] }).toBe('EXPIRED');

    await narrate('The approvals page shows it as expired - a system outcome, not a parent decision');
    await page.reload();
    await page.getByText('Recently resolved (last 7 days)').click();
    const expired = approvalCard(page, child.name);
    await expect(expired).toContainText('Expired — no response within 48 hours');
    await expect(expired).not.toContainText('DENIED');
    await expect(page.getByText("No pending approvals — you're all caught up.")).toBeVisible();
    await highlight(expired);

    await narrate('Both the parent and the child get an expiry notification');
    const parentMail = await mailbox.waitFor(parent.email, { subject: 'Your purchase request has expired' });
    const childMail = await mailbox.waitFor(login.email, { subject: 'Your purchase request has expired' });
    expect(parentMail.text).toContain('expired');
    await showEmail(page, childMail, 1800);

    await narrate('The child sees the request as Expired');
    await page.goto('/login');
    await loginAs(login.email, login.password);
    await shell(page).goTo('My requests');
    await expect(requestItem(page, title).getByText('Expired', { exact: true })).toBeVisible();
    // An expired request can no longer be approved (409).
    const late = await api.post(`/approvals/${created.id}/approve`, { auth: parent.session, body: {} });
    expect(late.status).toBe(409);
  });
});
