import {
  test,
  expect,
  highlight,
  shell,
  createTrainer,
  createPlayerLinkCode,
  registerParent,
  setPlayerAvailability,
  minutes,
  makePng,
  showEmail,
  validPhone,
  uniqueEmail,
  uniqueName,
  strongPassword,
} from '../support/test';
import { CLIENT_URL } from '../support/seed';

/**
 * Items the client approved on top of Epic-01 (Epic-01 spec lines 449, 492, 496 and Q-01.04):
 *  - US-01.09 "Suggest session times matching most players' availability"
 *  - US-01.11 skill level is read-only for the player, "trainer sets this"
 *  - US-01.11 profile photo "upload or URL"
 *  - Q-01.04 "add a welcome email"
 */
test.describe('Remaining spec items: suggested times, skill level, photo URL, welcome email', () => {
  test('trainer roster shows the top 3 suggested session times, ranked by how many players are available', async ({
    page,
    api,
    mailbox,
    narrate,
    loginAs,
  }) => {
    const trainer = await createTrainer(api, mailbox);
    const code = await createPlayerLinkCode(api, trainer);
    const [a, b, c, d] = [
      await registerParent(api, code, { isSelf: true }),
      await registerParent(api, code, { isSelf: true }),
      await registerParent(api, code, { isSelf: true }),
      await registerParent(api, code, { isSelf: true }),
    ];
    // Mon 5-8 PM: a+b+c. Wed 6-9 PM: a+b. Fri 9-10 AM: c. d has not set any times.
    await setPlayerAvailability(api, a.session, a.profiles[0].id, [
      { dayOfWeek: 1, startTime: minutes('17:00'), endTime: minutes('20:00') },
      { dayOfWeek: 3, startTime: minutes('18:00'), endTime: minutes('21:00') },
    ]);
    await setPlayerAvailability(api, b.session, b.profiles[0].id, [
      { dayOfWeek: 1, startTime: minutes('17:00'), endTime: minutes('20:00') },
      { dayOfWeek: 3, startTime: minutes('18:00'), endTime: minutes('21:00') },
    ]);
    await setPlayerAvailability(api, c.session, c.profiles[0].id, [
      { dayOfWeek: 1, startTime: minutes('17:00'), endTime: minutes('20:00') },
      { dayOfWeek: 5, startTime: minutes('09:00'), endTime: minutes('10:00') },
    ]);
    void d;

    await narrate('The trainer opens the Players roster');
    await loginAs(trainer.email, trainer.password);
    await shell(page).goTo('Players');

    await narrate('A "Suggested times" card lists the day/time slots that fit the most players');
    const card = page.getByRole('region', { name: 'Suggested times' });
    await expect(card).toBeVisible();
    const items = card.getByRole('listitem');
    await expect(items).toHaveCount(3);
    await expect(items.nth(0)).toHaveText('Mon 5:00-8:00 PM - 3 out of 4 players');
    await expect(items.nth(1)).toHaveText('Wed 6:00-9:00 PM - 2 out of 4 players');
    await expect(items.nth(2)).toHaveText('Fri 9:00-10:00 AM - 1 out of 4 players');
    await highlight(card);

    await narrate('The API returns the same ranking, scoped to this trainer');
    const res = await api.get<{ items: Array<{ label: string; availableCount: number }>; totalCount: number }>('/trainers/me/players/suggested-times', {
      auth: trainer.session,
    });
    expect(res.status).toBe(200);
    expect(res.body.totalCount).toBe(4);
    expect(res.body.items.map((i) => [i.label, i.availableCount])).toEqual([
      ['Mon 5:00-8:00 PM', 3],
      ['Wed 6:00-9:00 PM', 2],
      ['Fri 9:00-10:00 AM', 1],
    ]);
  });

  test('trainer sets a player\'s skill level on the roster; the parent sees it read-only', async ({ page, api, mailbox, narrate, loginAs }) => {
    const trainer = await createTrainer(api, mailbox);
    const parent = await registerParent(api, await createPlayerLinkCode(api, trainer), { isSelf: false });
    const kid = parent.profiles[0];

    await narrate('The trainer opens the roster: every new player starts as Beginner');
    await loginAs(trainer.email, trainer.password);
    await shell(page).goTo('Players');
    const select = page.getByRole('combobox', { name: `Skill level for ${kid.name}` });
    await expect(select).toHaveValue('BEGINNER');

    await narrate('The trainer sets the skill level to Elite');
    await select.selectOption('ELITE');
    await expect(page.getByText(`${kid.name} is now Elite.`)).toBeVisible();
    await expect(select).toHaveValue('ELITE');
    await highlight(select);

    await narrate('The trainer signs out; the parent signs in');
    await shell(page).signOut();
    await expect(page).toHaveURL(/\/login/);
    await loginAs(parent.email, parent.password);

    await narrate('The profile card shows the skill level');
    await page.goto('/profiles');
    const card = page.getByRole('link', { name: kid.name });
    await expect(card).toContainText('Skill: Elite');
    await highlight(card);

    await narrate('On the profile edit form it is a disabled, read-only field: only the trainer sets it');
    await card.click();
    const skill = page.getByLabel('Skill level');
    await expect(skill).toHaveValue('Elite');
    await expect(skill).toBeDisabled();
    await expect(page.getByText('Set by your trainer.')).toBeVisible();
    await highlight(skill);

    await narrate('Saving the form never changes it, and the API refuses a skillLevel from the family');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(skill).toHaveValue('Elite');
    const attempt = await api.request('PATCH', `/player-profiles/${kid.id}`, { auth: parent.session, body: { skillLevel: 'BEGINNER' } });
    expect(attempt.status).toBe(400);
    const stored = await api.get<{ skillLevel: string }>(`/player-profiles/${kid.id}`, { auth: parent.session });
    expect(stored.body.skillLevel).toBe('ELITE');
  });

  test('profile photo "upload or URL": an https image link is stored as typed and displays; http is refused', async ({ page, api, mailbox, narrate, loginAs }) => {
    const trainer = await createTrainer(api, mailbox);
    const app = shell(page);
    const imageUrl = `https://images.example.com/avatars/${uniqueName('Pic').lastName.toLowerCase()}.png`;
    // The e2e machine may be offline: answer the external image request locally.
    await page.route('https://images.example.com/**', (route) => route.fulfill({ status: 200, contentType: 'image/png', body: makePng([30, 90, 220], 64) }));

    await loginAs(trainer.email, trainer.password);
    await app.goTo('Account');
    await expect(app.userMenuButton.locator('img')).toHaveCount(0);

    await narrate('Next to the upload there is an "Or use an image URL" box');
    const urlInput = page.getByLabel('Or use an image URL');
    await expect(urlInput).toBeVisible();
    await highlight(urlInput);

    await narrate('A plain http link is refused');
    await urlInput.fill('http://images.example.com/avatars/me.png');
    await page.getByRole('button', { name: 'Use image URL' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Enter a valid image link starting with https://' })).toBeVisible();

    await narrate('An https image link is accepted and previewed');
    await urlInput.fill(imageUrl);
    await page.getByRole('button', { name: 'Use image URL' }).click();
    const preview = page.getByRole('img', { name: 'Photo preview' });
    await expect(preview).toHaveAttribute('src', imageUrl);
    await highlight(preview);

    await narrate('Save - the avatar appears in the user pill');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Profile saved.' })).toBeVisible();
    const avatar = app.userMenuButton.locator('img');
    await expect(avatar).toBeVisible();
    await expect(avatar).toHaveAttribute('src', imageUrl);
    await expect.poll(() => avatar.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);

    await narrate('The link is stored as typed (nothing was downloaded) and still shows after a reload');
    const me = await api.get<{ photoUrl: string }>('/me', { auth: trainer.session });
    expect(me.body.photoUrl).toBe(imageUrl);
    await page.reload();
    await expect(app.userMenuButton.locator('img')).toHaveAttribute('src', imageUrl);

    await narrate('The API refuses non-https and script URLs');
    for (const bad of ['http://images.example.com/a.png', 'javascript:alert(1)', 'data:image/png;base64,AAAA']) {
      const res = await api.request('PATCH', '/me', { auth: trainer.session, body: { photoUrl: bad } });
      expect(res.status, bad).toBe(400);
    }
  });

  test('welcome email arrives once when a trainer completes setup; a ShareLink registration gets no second welcome', async ({
    page,
    api,
    mailbox,
    narrate,
  }) => {
    const admin = await api.superAdmin();
    const email = uniqueEmail('welcome');
    const { firstName, lastName } = uniqueName('Welcome');
    const created = await api.post('/trainers', {
      auth: admin,
      body: { businessName: `${lastName} Academy`, firstName, lastName, email, phone: validPhone() },
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);

    await narrate('The trainer opens the setup link from the invitation email');
    const setupLink = await mailbox.linkTo(email, /register\?token=/);
    await page.goto(setupLink);
    await expect(page.getByRole('heading', { name: 'Complete your account' })).toBeVisible();

    await narrate('Choosing a password activates the account');
    await page.getByLabel('Choose a password').fill(strongPassword());
    await page.getByRole('button', { name: 'Complete setup' }).click();
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 });

    await narrate('A welcome email arrives in the mailbox');
    const welcome = await mailbox.waitFor(email, { subject: 'Welcome to PracticePerfect' });
    expect(welcome.templateId).toBe('EMAIL_WELCOME');
    expect(welcome.text).toContain(`Hi ${firstName},`);
    expect(welcome.links).toEqual([`${CLIENT_URL}/login`]);
    await showEmail(page, welcome, 3000);
    await highlight(page.getByRole('link', { name: 'Sign in' }));

    await narrate('Exactly one welcome email was sent');
    const all = await mailbox.list(email);
    expect(all.filter((m) => m.templateId === 'EMAIL_WELCOME')).toHaveLength(1);

    await narrate('A player registering through a ShareLink already gets the registration confirmation - no second welcome');
    const trainer = await createTrainer(api, mailbox);
    const parent = await registerParent(api, await createPlayerLinkCode(api, trainer), { isSelf: true });
    await mailbox.waitFor(parent.email, { subject: 'connected with' });
    const parentMails = await mailbox.list(parent.email);
    expect(parentMails.map((m) => m.templateId)).toContain('EMAIL_SHARELINK_CONFIRMATION');
    expect(parentMails.map((m) => m.templateId)).not.toContain('EMAIL_WELCOME');
  });
});
