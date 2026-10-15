import type { Page } from '@playwright/test';

import {
  test,
  expect,
  highlight,
  shell,
  createTrainer,
  createPlayerLinkCode,
  registerParent,
  createParentWithChildren,
  showEmail,
  expireShareLink,
  sql,
  strongPassword,
  uniqueEmail,
  uniqueName,
  type TrainerFixture,
} from '../support/test';

/**
 * US-01.02 - Player / parent registers via a trainer's ShareLink.
 * Static player link (generated in the UI) -> anonymous /join/<code> shows the trainer preview -> registration form ->
 * account created + auto-associated + confirmation/verification emails -> portal. Existing accounts are associated with a
 * second trainer without a duplicate account (family picker for parents with children); separated views via the context switcher.
 */
test.describe('US-01.02: Player registers via ShareLink', () => {
  const accentOf = (page: Page) =>
    page
      .locator('[data-branding]')
      .first()
      .evaluate((el) => (el as HTMLElement).style.getPropertyValue('--brand-primary').trim().toLowerCase());

  const sharelinkTable = (page: Page) => page.getByRole('table', { name: 'Share links' });

  /** Reads the code of the first data row of the trainer's Share Links table. */
  const firstLinkCode = async (page: Page) => (await sharelinkTable(page).locator('span.font-mono').first().innerText()).trim();

  const contextCurrent = (page: Page) => page.getByTestId('context-switcher-current');

  test('trainer generates a static player ShareLink in the UI: unlimited uses, never expires', async ({ page, api, mailbox, narrate, loginAs }) => {
    const trainer = await createTrainer(api, mailbox);

    await narrate('Trainer signs in and opens Share Links');
    await loginAs(trainer.email, trainer.password);
    await shell(page).goTo('Share Links');
    await expect(page.getByRole('heading', { name: 'Share Links', level: 1 })).toBeVisible();

    await narrate('Click "Generate Link": the modal offers a player link (unlimited, no expiry) and a coach link');
    await page.getByRole('button', { name: 'Generate Link' }).click();
    const dialog = page.getByRole('dialog', { name: 'Generate share link' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel('Player (unlimited, no expiry)')).toBeChecked();
    await expect(dialog.getByLabel('Coach (single-use, expires in 7 days)')).not.toBeChecked();
    await highlight(dialog);
    await dialog.getByRole('button', { name: 'Generate' }).click();
    await expect(dialog).toBeHidden();

    await narrate('The new link is listed: Player - Static, never expires, 0 uses, ACTIVE');
    const row = sharelinkTable(page).getByRole('row').filter({ hasText: 'Player — Static' });
    await expect(row).toHaveCount(1);
    await expect(row.getByText('Never', { exact: true })).toBeVisible();
    await expect(row.getByText('ACTIVE', { exact: true })).toBeVisible();
    await expect(row.getByRole('cell').nth(3)).toHaveText('0');
    await highlight(row);

    const code = await firstLinkCode(page);
    expect(code).toMatch(/^[A-Za-z0-9_-]{10,}$/);

    await narrate('The public preview API confirms the link belongs to this trainer');
    const preview = await api.get<{ valid: boolean; type: string; trainerDisplayName: string }>(`/share-links/${code}`);
    expect(preview.body).toMatchObject({ valid: true, type: 'PLAYER_STATIC', trainerDisplayName: trainer.businessName });
  });

  test('anonymous visitor sees the trainer preview and branding, registers (phone via country selector) and lands on the player portal', async ({
    page,
    api,
    mailbox,
    narrate,
    loginAs,
  }) => {
    const trainer = await createTrainer(api, mailbox);
    const code = await createPlayerLinkCode(api, trainer);
    const branded = await api.patch(`/trainers/${trainer.trainerId}/branding`, { auth: trainer.session, body: { primaryColorHex: '#1E5ADC' } });
    expect(branded.status).toBeLessThan(300);

    const parentEmail = uniqueEmail('newparent');
    const { firstName, lastName } = uniqueName('Registrant');
    const password = strongPassword();
    const playerName = `${firstName} ${lastName}`;

    await narrate("A visitor (not logged in) opens the trainer's link");
    await page.goto(`/join/${code}`);
    await expect(page.getByRole('heading', { name: `Join ${trainer.businessName}` })).toBeVisible();
    await expect(page.getByAltText(`${trainer.businessName} logo`)).toBeVisible();
    await narrate("The page already carries the trainer's identity and accent colour");
    await expect.poll(() => accentOf(page)).toBe('#1e5adc');
    await highlight(page.getByRole('heading', { name: `Join ${trainer.businessName}` }));

    await narrate('Submitting the empty form lists every required field');
    await page.getByRole('button', { name: 'Create account' }).click();
    for (const message of [
      'First name is required.',
      'Last name is required.',
      'Email is required.',
      'Password must be at least 8 characters.',
      'Phone number is required.',
      "Player's name is required.",
      'Date of birth is required.',
      'Select a gender.',
    ]) {
      await expect(page.getByText(message).first()).toBeVisible();
    }

    await narrate('Fill the form: parent name, email, password, phone with a country code, player name, date of birth, gender');
    await page.getByLabel('Who is this registration for?').selectOption('true');
    await page.getByLabel('Your first name').fill(firstName);
    await page.getByLabel('Your last name').fill(lastName);
    await page.getByLabel('Email').fill('not-an-email');
    await page.getByLabel('Password', { exact: true }).fill('short');
    await page.getByLabel('Phone number').fill('12');
    await page.getByLabel('Phone number').blur();
    await expect(page.getByText('Enter a valid email address, e.g. name@example.com.')).toBeVisible();
    await expect(page.getByText('Enter a valid phone number for the selected country.')).toBeVisible();

    await page.getByLabel('Email').fill(parentEmail);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByLabel('Country calling code').selectOption({ label: '+1 United States' });
    await page.getByLabel('Phone number').fill('4155552671');
    await page.getByLabel("Player's name").fill(playerName);
    await page.getByLabel('Date of birth').fill('1990-05-05');
    await page.getByLabel('Gender').selectOption({ label: 'female' });
    await highlight(page.getByLabel('Phone number'));

    await narrate('Create account');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByRole('status').filter({ hasText: `Welcome, ${firstName}!` })).toBeVisible();

    await narrate('The new player lands on their portal, already connected with the trainer');
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 });
    await expect(page.getByRole('heading', { name: `Welcome, ${firstName}` })).toBeVisible();
    await expect(contextCurrent(page)).toHaveText(`${playerName} (Me) → ${trainer.businessName}`);
    await expect.poll(() => accentOf(page)).toBe('#1e5adc');
    await highlight(contextCurrent(page));
    for (const label of ['Dashboard', 'Profiles', 'Approvals']) await expect(shell(page).navLink(label)).toBeVisible();

    await narrate('Two emails arrive: the confirmation and the e-mail verification link');
    const confirmation = await mailbox.waitFor(parentEmail, { subject: `You're connected with ${trainer.businessName}` });
    expect(confirmation.text).toContain(trainer.businessName);
    const verification = await mailbox.waitFor(parentEmail, { subject: /Verify your PracticePerfect email/i });
    expect(verification.links.some((l) => /\/verify-email\?token=/.test(l))).toBe(true);
    await showEmail(page, confirmation);
    await showEmail(page, verification);

    await narrate('The trainer sees the new player on the roster and the link usage went up to 1');
    await page.goto('/login');
    await loginAs(trainer.email, trainer.password);
    await shell(page).goTo('Players');
    const rosterRow = page.getByRole('table', { name: 'Player roster' }).getByRole('row', { name: playerName });
    await expect(rosterRow).toBeVisible();
    await expect(rosterRow.getByRole('cell').nth(1)).toHaveText(/^3\d$/);
    await highlight(rosterRow);
    await shell(page).goTo('Share Links');
    await expect(sharelinkTable(page).getByRole('row').filter({ hasText: 'Player — Static' }).getByRole('cell').nth(3)).toHaveText('1');
  });

  test('a parent can register a child through the link ("My child"): the child profile is created and associated with the trainer', async ({
    page,
    api,
    mailbox,
    narrate,
    loginAs,
  }) => {
    const trainer = await createTrainer(api, mailbox);
    const code = await createPlayerLinkCode(api, trainer);
    const parentEmail = uniqueEmail('childparent');
    const parent = uniqueName('Guardian');
    const child = uniqueName('Junior');
    const childName = `${child.firstName} ${child.lastName}`;

    await narrate('A parent opens the link and chooses "My child"');
    await page.goto(`/join/${code}`);
    await page.getByLabel('Who is this registration for?').selectOption('false');
    await page.getByLabel('Your first name').fill(parent.firstName);
    await page.getByLabel('Your last name').fill(parent.lastName);
    await page.getByLabel('Email').fill(parentEmail);
    await page.getByLabel('Password', { exact: true }).fill(strongPassword());
    await page.getByLabel('Phone number').fill('2025550143');
    await page.getByLabel("Player's name").fill(childName);

    await narrate('A date of birth that makes the child older than 18 is rejected: all players under 18 are parent-managed');
    await page.getByLabel('Date of birth').fill('2000-01-01');
    await page.getByLabel('Gender').selectOption({ label: 'male' });
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByText('Age must be between 1 and 18 years.')).toBeVisible();
    await highlight(page.getByText('Age must be between 1 and 18 years.'));

    const tenYearsAgo = new Date();
    tenYearsAgo.setFullYear(tenYearsAgo.getFullYear() - 10);
    await page.getByLabel('Date of birth').fill(tenYearsAgo.toISOString().slice(0, 10));
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByRole('status').filter({ hasText: `Welcome, ${parent.firstName}!` })).toBeVisible();
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 });

    await narrate('The parent portal shows the child (not the parent) as the trained player');
    await expect(contextCurrent(page)).toHaveText(`${childName} → ${trainer.businessName}`);
    await shell(page).goTo('Profiles');
    const card = page.getByRole('link', { name: childName });
    await expect(card).toBeVisible();
    await expect(card).toContainText('1 trainer');
    await expect(card).not.toContainText('Me');
    await highlight(card);

    await narrate("The trainer's roster lists the child with the derived age");
    await shell(page).signOut();
    await loginAs(trainer.email, trainer.password);
    await shell(page).goTo('Players');
    const row = page.getByRole('table', { name: 'Player roster' }).getByRole('row', { name: childName });
    await expect(row).toBeVisible();
    await expect(row.getByRole('cell').nth(1)).toHaveText('10');
  });

  test("an existing player opens a SECOND trainer's link: instantly associated, no duplicate account", async ({ page, api, mailbox, narrate, loginAs }) => {
    const trainerA = await createTrainer(api, mailbox);
    const trainerB = await createTrainer(api, mailbox);
    const codeA = await createPlayerLinkCode(api, trainerA);
    const codeB = await createPlayerLinkCode(api, trainerB);
    const player = await registerParent(api, codeA, { isSelf: true });
    const playerName = player.profiles[0].name;

    await narrate('The player is already logged in (registered through trainer A)');
    await loginAs(player.email, player.password);
    await expect(contextCurrent(page)).toHaveText(`${playerName} (Me) → ${trainerA.businessName}`);

    await narrate("Same browser: the player opens trainer B's ShareLink");
    await page.goto(`/join/${codeB}`);
    await expect(page.getByRole('heading', { name: `Join ${trainerB.businessName}` })).toBeVisible();
    await narrate('No registration form: a logged-in player only picks who joins');
    await expect(page.getByLabel('Password', { exact: true })).toHaveCount(0);
    await expect(page.getByText(`Who will train with ${trainerB.businessName}?`)).toBeVisible();
    await page.getByLabel('Me', { exact: true }).check();
    await page.getByRole('button', { name: 'Connect' }).click();
    await expect(page.getByRole('status').filter({ hasText: `Connected with ${trainerB.businessName}` })).toBeVisible();
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 });

    await narrate('Both trainers now appear in the context switcher of the SAME account');
    const select = page.getByRole('combobox', { name: 'Active trainer context' });
    await expect(select.locator('option')).toHaveCount(2);
    await expect(select.getByRole('option', { name: `${playerName} (Me) → ${trainerA.businessName}` })).toHaveCount(1);
    await expect(select.getByRole('option', { name: `${playerName} (Me) → ${trainerB.businessName}` })).toHaveCount(1);
    await highlight(select);

    await narrate('No duplicate account was created');
    const users = await sql(`SELECT count(*)::int AS n FROM "User" WHERE email = $1`, [player.email.toLowerCase()]);
    expect(users.rows[0].n).toBe(1);
    const profiles = await sql(`SELECT count(*)::int AS n FROM "PlayerProfile" WHERE "accountUserId" = $1`, [player.userId]);
    expect(profiles.rows[0].n).toBe(1);

    await narrate('Trainer B sees the player on the roster, usage of link B is 1');
    await shell(page).signOut();
    await loginAs(trainerB.email, trainerB.password);
    await shell(page).goTo('Players');
    await expect(page.getByRole('table', { name: 'Player roster' }).getByRole('row', { name: playerName })).toBeVisible();
    await shell(page).goTo('Share Links');
    await expect(sharelinkTable(page).getByRole('row').filter({ hasText: 'Player — Static' }).getByRole('cell').nth(3)).toHaveText('1');
  });

  test('parent with children sees "Who will train with ...?" (Me + children): only the selected family members are associated', async ({
    page,
    api,
    mailbox,
    narrate,
    loginAs,
  }) => {
    const trainerA = await createTrainer(api, mailbox);
    const trainerB = await createTrainer(api, mailbox);
    const childOne = `Alexa ${uniqueName('Kid').lastName}`;
    const childTwo = `Maya ${uniqueName('Kid').lastName}`;
    const family = await createParentWithChildren(api, trainerA, [childOne, childTwo]);
    const selfName = family.profiles.find((p) => p.isSelf)!.name;
    const codeB = await createPlayerLinkCode(api, trainerB);

    await narrate("The parent (with two children) signs in and opens trainer B's link");
    await loginAs(family.email, family.password);
    await page.goto(`/join/${codeB}`);
    await expect(page.getByText(`Who will train with ${trainerB.businessName}?`)).toBeVisible();

    await narrate('The checklist shows Parent (Me) + every child, and Connect is disabled until someone is ticked');
    const checklist = page.getByRole('group', { name: `Who will train with ${trainerB.businessName}?` });
    await expect(checklist.getByLabel('Me', { exact: true })).toBeVisible();
    await expect(checklist.getByLabel(childOne)).toBeVisible();
    await expect(checklist.getByLabel(childTwo)).toBeVisible();
    await expect(checklist.getByRole('checkbox')).toHaveCount(3);
    await expect(page.getByRole('button', { name: 'Connect' })).toBeDisabled();
    await highlight(checklist);

    await narrate('Select only the second child and connect');
    await checklist.getByLabel(childTwo).check();
    await expect(page.getByRole('button', { name: 'Connect' })).toBeEnabled();
    await page.getByRole('button', { name: 'Connect' }).click();
    await expect(page.getByRole('status').filter({ hasText: `Connected with ${trainerB.businessName}` })).toBeVisible();
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 });

    await narrate('Context switcher: only the second child trains with trainer B; the others stay with trainer A only');
    const select = page.getByRole('combobox', { name: 'Active trainer context' });
    await expect(select.getByRole('option', { name: `${childTwo} → ${trainerB.businessName}` })).toHaveCount(1);
    await expect(select.getByRole('option', { name: `${childOne} → ${trainerB.businessName}` })).toHaveCount(0);
    await expect(select.getByRole('option', { name: `${selfName} (Me) → ${trainerB.businessName}` })).toHaveCount(0);
    await expect(select.getByRole('option', { name: `${childOne} → ${trainerA.businessName}` })).toHaveCount(1);
    const summary = page.getByText("Your Children's Training:");
    await expect(summary).toContainText(childTwo);
    await expect(summary).toContainText(trainerA.businessName);
    await expect(summary).toContainText(trainerB.businessName);
    await expect(summary).toContainText(`${childOne} → ${trainerA.businessName}`);
    await highlight(summary);

    await narrate("Trainer B's roster lists exactly one family member");
    await shell(page).signOut();
    await loginAs(trainerB.email, trainerB.password);
    await shell(page).goTo('Players');
    const table = page.getByRole('table', { name: 'Player roster' });
    await expect(table.getByRole('row', { name: childTwo })).toBeVisible();
    await expect(table.getByRole('row', { name: childOne })).toHaveCount(0);
    await expect(table.getByRole('row', { name: selfName })).toHaveCount(0);
  });

  test('separated views: the context switcher swaps the trainer context (branding follows) and the selection persists across a reload', async ({
    page,
    api,
    mailbox,
    narrate,
    loginAs,
  }) => {
    const trainerA = await createTrainer(api, mailbox);
    const trainerB = await createTrainer(api, mailbox);
    const trainerC = await createTrainer(api, mailbox);
    const brand = new Map([
      [trainerA.businessName, '#1e5adc'],
      [trainerB.businessName, '#d62828'],
      [trainerC.businessName, '#8a2be2'],
    ]);
    for (const [t, hex] of [
      [trainerA, '#1E5ADC'],
      [trainerB, '#D62828'],
      [trainerC, '#8A2BE2'],
    ] as const) {
      expect((await api.patch(`/trainers/${t.trainerId}/branding`, { auth: t.session, body: { primaryColorHex: hex } })).status).toBeLessThan(300);
    }
    const codeA = await createPlayerLinkCode(api, trainerA);
    const codeB = await createPlayerLinkCode(api, trainerB);
    const codeC = await createPlayerLinkCode(api, trainerC);
    const player = await registerParent(api, codeA, { isSelf: true });
    const playerName = player.profiles[0].name;
    await api.post(`/share-links/${codeB}/redeem`, { auth: player.session, body: { subjectProfileIds: [player.profiles[0].id] } });
    const otherPlayer = await registerParent(api, codeC, { isSelf: true });
    const label = (t: TrainerFixture) => `${playerName} (Me) → ${t.businessName}`;

    await narrate('The player (connected with trainers A and B) signs in');
    await loginAs(player.email, player.password);
    const select = page.getByRole('combobox', { name: 'Active trainer context' });
    await expect(select.locator('option')).toHaveCount(2);
    const firstText = (await contextCurrent(page).innerText()).trim();
    const first = firstText === label(trainerA) ? trainerA : trainerB;
    const second = first === trainerA ? trainerB : trainerA;
    await narrate("The portal opens in the first context, wearing that trainer's colours");
    await expect(contextCurrent(page)).toHaveText(label(first));
    await expect.poll(() => accentOf(page)).toBe(brand.get(first.businessName));

    await narrate('Switch the context to the other trainer: label and branding change completely');
    await select.selectOption({ label: label(second) });
    await expect(contextCurrent(page)).toHaveText(label(second));
    await expect.poll(() => accentOf(page)).toBe(brand.get(second.businessName));
    await highlight(contextCurrent(page));

    await narrate('Reload the page: the current context persists');
    await page.reload();
    await expect(contextCurrent(page)).toHaveText(label(second));
    await expect.poll(() => accentOf(page)).toBe(brand.get(second.businessName));

    await narrate('Navigating inside the app keeps the context too, and switching back restores the first trainer');
    await shell(page).goTo('Profiles');
    await expect(contextCurrent(page)).toHaveText(label(second));
    await select.selectOption({ label: label(first) });
    await expect.poll(() => accentOf(page)).toBe(brand.get(first.businessName));
    await expect(contextCurrent(page)).toHaveText(label(first));
    await select.selectOption({ label: label(second) });
    await expect(contextCurrent(page)).toHaveText(label(second));

    await narrate('A different family signs in on the same browser: its own context, not the previous selection');
    await shell(page).signOut();
    await loginAs(otherPlayer.email, otherPlayer.password);
    await expect(contextCurrent(page)).toHaveText(`${otherPlayer.profiles[0].name} (Me) → ${trainerC.businessName}`);
    await expect.poll(() => accentOf(page)).toBe('#8a2be2');
    await expect(page.getByText('This connection is no longer active.')).toHaveCount(0);
    await highlight(contextCurrent(page));
  });

  test('existing-user path: "Already have an account? Sign in" returns to the join flow after login', async ({ page, api, mailbox, narrate }) => {
    const trainerA = await createTrainer(api, mailbox);
    const trainerB = await createTrainer(api, mailbox);
    const codeA = await createPlayerLinkCode(api, trainerA);
    const codeB = await createPlayerLinkCode(api, trainerB);
    const player = await registerParent(api, codeA, { isSelf: true });

    await narrate("A visitor who already has an account opens trainer B's link");
    await page.goto(`/join/${codeB}`);
    await expect(page.getByRole('heading', { name: `Join ${trainerB.businessName}` })).toBeVisible();
    const signIn = page.getByRole('link', { name: 'Sign in' });
    await expect(page.getByText('Already have an account?')).toBeVisible();
    await highlight(signIn);

    await narrate('"Sign in" opens the login page carrying a return path to the join link');
    await signIn.click();
    await expect(page).toHaveURL(new RegExp(`/login\\?next=/join/${codeB}`));
    await page.getByLabel('Email').fill(player.email);
    await page.getByLabel('Password', { exact: true }).fill(player.password);
    await page.getByRole('button', { name: 'Sign in' }).click();

    await narrate('After signing in the player is back on the join flow, now with the family picker');
    await expect(page).toHaveURL(new RegExp(`/join/${codeB}$`), { timeout: 20_000 });
    await expect(page.getByRole('heading', { name: `Join ${trainerB.businessName}` })).toBeVisible();
    await expect(page.getByText(`Who will train with ${trainerB.businessName}?`)).toBeVisible();
    await page.getByLabel('Me', { exact: true }).check();
    await page.getByRole('button', { name: 'Connect' }).click();
    await expect(page.getByRole('status').filter({ hasText: `Connected with ${trainerB.businessName}` })).toBeVisible();
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 });
    await expect(page.getByRole('combobox', { name: 'Active trainer context' }).locator('option')).toHaveCount(2);
  });

  test('coach link generated in the UI is unique, single-use and expires after 7 days', async ({ page, api, mailbox, narrate, loginAs }) => {
    const trainer = await createTrainer(api, mailbox);
    const coachEmail = uniqueEmail('linkcoach');
    const coach = uniqueName('Linda');
    const expiringEmail = uniqueEmail('latecoach');

    await narrate("Trainer generates a COACH link: single-use, 7-day expiry, bound to the coach's email");
    await loginAs(trainer.email, trainer.password);
    await shell(page).goTo('Share Links');
    await page.getByRole('button', { name: 'Generate Link' }).click();
    const dialog = page.getByRole('dialog', { name: 'Generate share link' });
    await dialog.getByLabel('Coach (single-use, expires in 7 days)').check();
    await dialog.getByRole('button', { name: 'Generate' }).click();
    await expect(dialog.getByText('Email is required for a coach invite link.')).toBeVisible();
    await dialog.getByLabel('Coach email').fill(coachEmail);
    await dialog.getByRole('button', { name: 'Generate' }).click();
    await expect(dialog).toBeHidden();

    const row = sharelinkTable(page).getByRole('row').filter({ hasText: coachEmail });
    await expect(row).toBeVisible();
    await expect(row.getByText('Coach — Unique')).toBeVisible();
    await expect(row.getByText('ACTIVE', { exact: true })).toBeVisible();
    const inSevenDays = await page.evaluate(() => new Date(Date.now() + 7 * 24 * 3600 * 1000).toLocaleDateString());
    await expect(row.getByText(inSevenDays, { exact: true })).toBeVisible();
    await highlight(row);
    const code = (await row.locator('span.font-mono').innerText()).trim();

    await narrate('The coach (anonymous) opens the unique link and accepts it with a name and password');
    await shell(page).signOut();
    await page.goto(`/join/${code}`);
    await expect(page.getByRole('heading', { name: `Join ${trainer.businessName}` })).toBeVisible();
    await page.getByLabel('First name').fill(coach.firstName);
    await page.getByLabel('Last name').fill(coach.lastName);
    await page.getByLabel('Choose a password').fill(strongPassword());
    await page.getByRole('button', { name: 'Accept invitation' }).click();
    await expect(page.getByRole('status').filter({ hasText: `Welcome, ${coach.firstName}!` })).toBeVisible();
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 });
    await expect(shell(page).nav.getByRole('link', { name: 'My Times', exact: true })).toBeVisible();

    await narrate('A second use of the same link is rejected');
    await shell(page).signOut();
    await page.goto(`/join/${code}`);
    const used = page.getByRole('alert').filter({ hasText: /This invitation link has (expired|already been used)/ });
    await expect(used).toBeVisible();
    await highlight(used);
    const redeemAgain = await api.post(`/share-links/${code}/redeem`, { body: { firstName: 'Again', lastName: 'Coach', password: strongPassword() } });
    expect(redeemAgain.status).toBe(409);

    await narrate('A coach link older than 7 days stops working (expiry simulated in the e2e database)');
    const second = await api.post<{ code: string }>('/share-links', { auth: trainer.session, body: { type: 'COACH_UNIQUE', targetEmail: expiringEmail } });
    expect(second.status).toBeLessThan(300);
    await expireShareLink(second.body.code);
    await page.goto(`/join/${second.body.code}`);
    const expired = page.getByRole('alert').filter({ hasText: 'This invitation link has expired. Ask your trainer for a new one.' });
    await expect(expired).toBeVisible();
    await highlight(expired);
  });

  test('unknown, revoked and trainer-side visits to a player link show clear messages and never register anyone', async ({
    page,
    api,
    mailbox,
    narrate,
    loginAs,
  }) => {
    const trainer: TrainerFixture = await createTrainer(api, mailbox);
    const code = await createPlayerLinkCode(api, trainer);

    await narrate('A link that never existed');
    await page.goto('/join/this-code-does-not-exist');
    const unknown = page.getByRole('alert').filter({ hasText: "This invitation link doesn't exist." });
    await expect(unknown).toBeVisible();
    await highlight(unknown);

    await narrate('A trainer opens a player link: trainers cannot join as participants');
    await loginAs(trainer.email, trainer.password);
    await page.goto(`/join/${code}`);
    await expect(page.getByText("This invitation is for players and coaches. Your account can't join as a participant.")).toBeVisible();

    await narrate('The trainer revokes the link on the Share Links page');
    await page.goto('/share-links');
    const row = sharelinkTable(page).getByRole('row', { name: code });
    await row.getByRole('button', { name: 'Revoke' }).click();
    await page.getByRole('dialog', { name: 'Confirm revoke' }).getByRole('button', { name: 'Yes, revoke' }).click();
    await expect(row.getByText('REVOKED', { exact: true })).toBeVisible();
    await highlight(row);

    await narrate('A visitor with the revoked link sees that it is no longer active');
    await shell(page).signOut();
    await page.goto(`/join/${code}`);
    const revoked = page.getByRole('alert').filter({ hasText: 'This invitation link is no longer active.' });
    await expect(revoked).toBeVisible();
    await highlight(revoked);
    expect((await api.post(`/share-links/${code}/redeem`, { body: { email: uniqueEmail('late') } })).status).toBe(409);
  });
});
