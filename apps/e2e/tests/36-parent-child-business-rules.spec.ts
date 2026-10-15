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
  connectProfilesViaLink,
  dobForAge,
  strongPassword,
  uniqueEmail,
  uniqueName,
  sql,
} from '../support/test';

/**
 * Epic-01 business rules for the player / parent / child side (spec section 9):
 * all players under 18 are parent-managed, one role per user, e-mail uniqueness, multi-trainer isolation.
 */
test.describe('Business rules: parents, children, roles and multi-trainer isolation', () => {
  test('all players under 18 are parent-managed: a minor cannot register or be added as an independent "Me" player', async ({
    page,
    api,
    mailbox,
    narrate,
  }) => {
    const trainer = await createTrainer(api, mailbox);
    const code = await createPlayerLinkCode(api, trainer);
    const name = uniqueName('Minor');

    await narrate('A 10-year-old tries to register for themselves ("Me") through the ShareLink');
    await page.goto(`/join/${code}`);
    await page.getByLabel('Who is this registration for?').selectOption('true');
    await page.getByLabel('Your first name').fill(name.firstName);
    await page.getByLabel('Your last name').fill(name.lastName);
    await page.getByLabel('Email').fill(uniqueEmail('minor'));
    await page.getByLabel('Password', { exact: true }).fill(strongPassword());
    await page.getByLabel('Phone number').fill('2025550143');
    await page.getByLabel("Player's name").fill(`${name.firstName} ${name.lastName}`);
    await page.getByLabel('Date of birth').fill(dobForAge(10));
    await page.getByLabel('Gender').selectOption({ label: 'male' });
    await page.getByRole('button', { name: 'Create account' }).click();
    const rule = page.getByText('Players under 18 must be registered by a parent - choose "My child".');
    await expect(rule).toBeVisible();
    await highlight(rule);
    await expect(page.getByRole('status').filter({ hasText: 'Welcome' })).toHaveCount(0);

    await narrate('The server enforces it too (anonymous registration as "Me" with a minor date of birth)');
    const email = uniqueEmail('minorapi');
    const direct = await api.post(`/share-links/${code}/redeem`, {
      body: { email, password: strongPassword(), phone: '+14155552671', playerName: 'Minor Self', dateOfBirth: dobForAge(10), gender: 'MALE', isSelf: true },
    });
    expect(direct.status).toBe(400);
    expect((await sql(`SELECT count(*)::int AS n FROM "User" WHERE email = $1`, [email])).rows[0].n).toBe(0);

    await narrate('A parent registers the 10-year-old as "My child": the account belongs to the parent');
    await page.getByLabel('Who is this registration for?').selectOption('false');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByRole('status').filter({ hasText: `Welcome, ${name.firstName}!` })).toBeVisible();
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 });
    const profile = await sql(
      `SELECT p."isSelf", p."childUserId" IS NULL AS "noOwnLogin", u.role FROM "PlayerProfile" p JOIN "User" u ON u.id = p."accountUserId" WHERE p.name = $1`,
      [`${name.firstName} ${name.lastName}`],
    );
    expect(profile.rows).toEqual([{ isSelf: false, noOwnLogin: true, role: 'PLAYER_PARENT' }]);

    await narrate('"Add myself as a player" refuses a minor date of birth as well (children use "+ Add Child")');
    await shell(page).goTo('Profiles');
    await page.getByRole('button', { name: 'Add myself as a player' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add myself as a player' });
    await dialog.getByLabel('Date of birth').fill(dobForAge(12));
    await dialog.getByLabel('Gender').selectOption({ label: 'female' });
    await dialog.getByRole('button', { name: 'Add myself' }).click();
    await expect(dialog.getByText('Players under 18 are added as a child profile instead.')).toBeVisible();
    await highlight(dialog);
    await dialog.getByRole('button', { name: 'Cancel' }).click();
  });

  test('e-mail uniqueness and single role: an address that belongs to a trainer or coach cannot be used to register as a player', async ({
    page,
    api,
    mailbox,
    narrate,
  }) => {
    const trainerA = await createTrainer(api, mailbox);
    const trainerB = await createTrainer(api, mailbox);
    const coach = await createCoach(api, mailbox, trainerB);
    const code = await createPlayerLinkCode(api, trainerA);
    const existingPlayer = await registerParent(api, code, { isSelf: true });
    const person = uniqueName('Dupe');

    async function tryRegisterWith(email: string, label: string) {
      await narrate(label);
      await page.goto(`/join/${code}`);
      await page.getByLabel('Your first name').fill(person.firstName);
      await page.getByLabel('Your last name').fill(person.lastName);
      await page.getByLabel('Email').fill(email);
      await page.getByLabel('Password', { exact: true }).fill(strongPassword());
      await page.getByLabel('Phone number').fill('2025550143');
      await page.getByLabel("Player's name").fill(`${person.firstName} ${person.lastName}`);
      await page.getByLabel('Date of birth').fill('1988-03-03');
      await page.getByLabel('Gender').selectOption({ label: 'female' });
      await page.getByRole('button', { name: 'Create account' }).click();
      const error = page.getByRole('alert').filter({ hasText: /\S/ }).filter({ hasNotText: 'Loading' });
      await expect(error.first()).toBeVisible();
      await highlight(error.first());
      await expect(page.getByRole('status').filter({ hasText: 'Welcome' })).toHaveCount(0);
      await expect(page).toHaveURL(new RegExp(`/join/${code}$`));
    }

    await tryRegisterWith(existingPlayer.email.toUpperCase(), 'An e-mail that already belongs to a player (even in other letter case) is rejected');
    await tryRegisterWith(trainerB.email, "A trainer's e-mail cannot become a player account: one role per user");
    await tryRegisterWith(coach.email, "A coach's e-mail cannot become a player account either");

    await narrate('No duplicate accounts and the roles are unchanged');
    for (const [email, role] of [
      [existingPlayer.email, 'PLAYER_PARENT'],
      [trainerB.email, 'TRAINER'],
      [coach.email, 'COACH'],
    ] as const) {
      const rows = await sql(`SELECT role FROM "User" WHERE lower(email) = lower($1)`, [email]);
      expect(rows.rows).toEqual([{ role }]);
    }

    await narrate('A user cannot change their own role through the API either');
    const attempt = await api.patch('/users/me', { auth: existingPlayer.session, body: { role: 'TRAINER' } });
    expect(attempt.status).toBeGreaterThanOrEqual(400);
    const me = await api.get<{ role: string }>('/me/bootstrap', { auth: existingPlayer.session });
    expect(me.body.role).toBe('PLAYER_PARENT');

    await narrate("A child's own login cannot reuse an existing e-mail either");
    const kid = await addChildProfile(api, existingPlayer, { trainerIds: [trainerA.trainerId] });
    const res = await api.post(`/player-profiles/${kid.id}/child-login`, { auth: existingPlayer.session, body: { email: coach.email, password: strongPassword() } });
    expect(res.status).toBe(409);
  });

  test('multi-trainer isolation: after switching, the player works in exactly one trainer context - others are refused (403 TENANT_CONTEXT_INVALID)', async ({
    page,
    api,
    mailbox,
    narrate,
    loginAs,
  }) => {
    const trainerA = await createTrainer(api, mailbox);
    const trainerB = await createTrainer(api, mailbox);
    const stranger = await createTrainer(api, mailbox);
    const player = await registerParent(api, await createPlayerLinkCode(api, trainerA), { isSelf: true });
    await connectProfilesViaLink(api, player, await createPlayerLinkCode(api, trainerB), [player.profiles[0].id]);
    const label = (t: { businessName: string }) => `${player.profiles[0].name} (Me) → ${t.businessName}`;

    await narrate('The server only accepts a trainer context the player is actually connected with');
    const asA = await api.get<{ activeContext: { trainerDisplayName: string } }>('/me/bootstrap', { auth: player.session, headers: { 'X-Trainer-Context': trainerA.trainerId } });
    expect(asA.status).toBe(200);
    expect(asA.body.activeContext.trainerDisplayName).toBe(trainerA.businessName);
    const asB = await api.get<{ activeContext: { trainerDisplayName: string } }>('/me/bootstrap', { auth: player.session, headers: { 'X-Trainer-Context': trainerB.trainerId } });
    expect(asB.body.activeContext.trainerDisplayName).toBe(trainerB.businessName);
    const asStranger = await api.get<{ errorCode: string }>('/me/bootstrap', { auth: player.session, headers: { 'X-Trainer-Context': stranger.trainerId } });
    expect(asStranger.status).toBe(403);
    expect(asStranger.body.errorCode).toBe('TENANT_CONTEXT_INVALID');

    await narrate('In the UI every request carries the CURRENT trainer context; switching changes it');
    const contextHeaders: string[] = [];
    page.on('request', (req) => {
      if (req.url().includes('/me/bootstrap')) contextHeaders.push(req.headers()['x-trainer-context'] ?? '');
    });
    await loginAs(player.email, player.password);
    const select = page.getByRole('combobox', { name: 'Active trainer context' });
    await select.selectOption({ label: label(trainerA) });
    await expect(page.getByTestId('context-switcher-current')).toHaveText(label(trainerA));
    await expect.poll(() => contextHeaders.at(-1)).toBe(trainerA.trainerId);
    await select.selectOption({ label: label(trainerB) });
    await expect(page.getByTestId('context-switcher-current')).toHaveText(label(trainerB));
    await expect.poll(() => contextHeaders.at(-1)).toBe(trainerB.trainerId);
    await highlight(page.getByTestId('context-switcher-current'));

    await narrate('A tampered context cookie (a trainer the player is NOT connected with) is not trusted: the portal recovers');
    await page.context().addCookies([{ name: 'activeTrainerId', value: stranger.trainerId, url: page.url() }]);
    await page.reload();
    await expect(page.getByTestId('context-switcher-current')).toBeVisible();
    await expect(page.getByTestId('context-switcher-current')).not.toContainText(stranger.businessName);
    await expect(page.getByTestId('context-switcher-current')).toContainText(player.profiles[0].name);

    await narrate("The player cannot reach any trainer's own data: roster, share links and branding of both trainers are forbidden");
    for (const t of [trainerA, trainerB, stranger]) {
      expect((await api.get(`/trainers/${t.trainerId}/players`, { auth: player.session })).status).toBeGreaterThanOrEqual(403);
      expect((await api.get(`/trainers/${t.trainerId}/share-links`, { auth: player.session })).status).toBeGreaterThanOrEqual(403);
    }
    await page.goto('/players');
    await expect(page).not.toHaveURL(/\/players$/, { timeout: 20_000 });
  });
});
