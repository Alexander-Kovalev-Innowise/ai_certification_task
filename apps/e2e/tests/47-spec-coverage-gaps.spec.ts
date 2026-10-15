import type { Page } from '@playwright/test';

import {
  test,
  expect,
  highlight,
  shell,
  sql,
  createTrainer,
  createCoach,
  createPlayerLinkCode,
  createParentWithChildren,
  connectProfilesViaLink,
  registerParent,
  uniqueEmail,
  uniqueName,
  strongPassword,
  validPhone,
} from '../support/test';

/**
 * Epic-01 functionality that already existed but had no video yet:
 *  - Super Admin edits ANOTHER user's account (PATCH /users/:id) and a trainer's business profile (PATCH /trainers/:id)
 *  - Trainer removes a coach / a player from the organisation (soft removal, history kept)
 *  - Super Admin "Resend setup email" (new link works, old one is dead)
 *  - the TrainerCreationLog audit record (spec US-01.01: "Audit log: record who created trainer, when, and trainer details")
 *  - Player/parent edits an existing player profile (school, jersey number, emergency contact; US-01.11)
 */

async function openUserCard(page: Page, email: string, fullName: string) {
  await shell(page).goTo('Users');
  await page.getByLabel('Search').fill(email);
  await page.getByRole('table', { name: 'Users' }).getByRole('row', { name: fullName }).getByRole('link', { name: 'Edit user' }).click();
  await expect(page.getByRole('heading', { name: 'Edit user', level: 1 })).toBeVisible();
}

test.describe('Super Admin edits another user (PATCH /users/:id, PATCH /trainers/:id)', () => {
  test("edits a user's name and phone on the user card; email/role/status are read-only; values persist after reload", async ({
    page,
    api,
    mailbox,
    seed,
    narrate,
    loginAs,
  }) => {
    const trainer = await createTrainer(api, mailbox);
    const admin = await api.superAdmin();
    const oldName = `${trainer.firstName} ${trainer.lastName}`;

    await narrate("Super Admin signs in and opens the trainer's user card");
    await loginAs(seed.superAdmin.email, seed.superAdmin.password);
    await openUserCard(page, trainer.email, oldName);

    await narrate('Email, role, status and creation date are shown but not editable');
    await expect(page.getByText('Role', { exact: true })).toBeVisible();
    await expect(page.getByText('Status', { exact: true })).toBeVisible();
    await expect(page.getByText('Created', { exact: true })).toBeVisible();
    await expect(page.getByText(trainer.email)).toBeVisible();
    await expect(page.getByLabel('Email', { exact: true })).toHaveCount(0);
    await expect(page.getByLabel('Role', { exact: true })).toHaveCount(0);

    await narrate('Required fields and name / phone formats are validated');
    await page.getByLabel('First name').fill('');
    await page.getByLabel('Last name').fill('Smith9');
    await page.getByLabel('Phone').fill('12');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('First name is required.')).toBeVisible();
    await expect(page.getByText('Last name can only contain letters, spaces, hyphens and apostrophes.')).toBeVisible();
    await expect(page.getByText('Enter a valid phone number for the selected country.')).toBeVisible();
    await highlight(page.getByText('Enter a valid phone number for the selected country.'));

    await narrate("Fix the values and save the OTHER user's profile");
    const newFirst = 'Morgan';
    const newLast = `${trainer.lastName}-Reyes`;
    await page.getByLabel('First name').fill(newFirst);
    await page.getByLabel('Last name').fill(newLast);
    await page.getByLabel('Phone').fill('2025550188');
    await page.getByRole('button', { name: 'Save changes' }).click();
    const saved = page.getByRole('status').filter({ hasText: 'Saved.' });
    await expect(saved).toBeVisible();
    await highlight(saved);
    await expect(page.getByRole('heading', { name: `${newFirst} ${newLast}` })).toBeVisible();

    await narrate('After a reload the card shows the persisted values');
    await page.reload();
    await expect(page.getByLabel('First name')).toHaveValue(newFirst);
    await expect(page.getByLabel('Last name')).toHaveValue(newLast);
    await expect(page.getByLabel('Phone')).toHaveValue(/555-0188/);
    await expect(page.getByText(trainer.email)).toBeVisible();

    await narrate('The API agrees, and the trainer sees the new name in their own account');
    const stored = await api.get<{ firstName: string; lastName: string; phone: string; email: string; role: string }>(`/users/${trainer.userId}`, {
      auth: admin,
    });
    expect(stored.body).toMatchObject({ firstName: newFirst, lastName: newLast, phone: '+12025550188', email: trainer.email, role: 'TRAINER' });
    const own = await api.get<{ firstName: string; lastName: string }>('/me', { auth: trainer.session });
    expect(own.body).toMatchObject({ firstName: newFirst, lastName: newLast });
    await narrate('Users directory lists the new name');
    await shell(page).goTo('Users');
    await page.getByLabel('Search').fill(trainer.email);
    await expect(page.getByRole('table', { name: 'Users' }).getByRole('row', { name: `${newFirst} ${newLast}` })).toBeVisible();
  });

  test("edits a trainer's business profile (PATCH /trainers/:id) while impersonating the trainer", async ({ page, api, mailbox, seed, narrate, loginAs }) => {
    const trainer = await createTrainer(api, mailbox);
    const admin = await api.superAdmin();
    const app = shell(page);
    const fullName = `${trainer.firstName} ${trainer.lastName}`;
    const newBusiness = `${trainer.lastName} Elite Hoops`;

    await narrate("Super Admin impersonates the trainer to edit the trainer's business profile");
    await loginAs(seed.superAdmin.email, seed.superAdmin.password);
    await openUserCard(page, trainer.email, fullName);
    await page.getByRole('button', { name: 'Impersonate', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Impersonate', exact: true }).click();
    const banner = page.getByTestId('impersonation-banner');
    await expect(banner).toContainText(`Viewing as ${fullName} (TRAINER)`);

    await app.goTo('Account');
    await expect(page.getByRole('heading', { name: 'Business', level: 2 })).toBeVisible();
    await expect(page.getByLabel('Business name')).toHaveValue(trainer.businessName);

    await narrate('Change the business name, address, website and description, then save');
    await page.getByLabel('Business name').fill(newBusiness);
    await page.getByLabel('Address').fill('77 Court Street, Springfield');
    await page.getByLabel('Website').fill('https://elite-hoops.example.com');
    await page.getByLabel('Description').fill('Edited by the Super Admin on behalf of the trainer.');
    await page.getByRole('button', { name: 'Save business details' }).click();
    const toast = page.getByRole('status').filter({ hasText: 'Business details saved.' });
    await expect(toast).toBeVisible();
    await highlight(toast);

    await narrate('Exit impersonation and check the stored trainer profile as Super Admin');
    await banner.getByRole('button', { name: 'Exit Impersonation' }).click();
    await expect(banner).toBeHidden({ timeout: 15_000 });
    const stored = await api.get<{ businessName: string; address: string; website: string; description: string }>(`/trainers/${trainer.trainerId}`, {
      auth: admin,
    });
    expect(stored.status).toBe(200);
    expect(stored.body).toMatchObject({
      businessName: newBusiness,
      address: '77 Court Street, Springfield',
      website: 'https://elite-hoops.example.com',
      description: 'Edited by the Super Admin on behalf of the trainer.',
    });

    await narrate('The Super Admin role itself may PATCH /trainers/:id too (API)');
    const direct = await api.patch<{ businessName: string }>(`/trainers/${trainer.trainerId}`, { auth: admin, body: { businessName: `${newBusiness} II` } });
    expect(direct.status).toBe(200);
    expect(direct.body.businessName).toBe(`${newBusiness} II`);

    await narrate('The trainer sees the edited business name on their own dashboard');
    await app.signOut();
    await loginAs(trainer.email, trainer.password);
    await expect(page.getByText(`${newBusiness} II`).first()).toBeVisible();
  });
});

test.describe('Trainer removes people from the organisation', () => {
  test('removes a coach: confirmation explains the consequence, the coach disappears and is signed out, history is kept', async ({
    page,
    api,
    mailbox,
    narrate,
    loginAs,
  }) => {
    const trainer = await createTrainer(api, mailbox);
    const coach = await createCoach(api, mailbox, trainer);
    const coachName = `${coach.firstName} ${coach.lastName}`;
    const row = page.getByRole('table', { name: 'Coach roster' }).getByRole('row').filter({ hasText: coach.email });

    await narrate('Trainer signs in and opens the coach roster');
    await loginAs(trainer.email, trainer.password);
    await shell(page).goTo('Coaches');
    await expect(row).toBeVisible();
    await highlight(row);

    await narrate('Remove the coach: the dialog says what will happen');
    await row.getByRole('button', { name: `Remove ${coachName}` }).click();
    const dialog = page.getByRole('dialog', { name: 'Remove coach' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(`${coachName} will be removed from your organisation and signed out.`);
    await expect(dialog).toContainText('Their history is kept');
    await highlight(dialog);

    await narrate('Cancel leaves everything as it was');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
    await expect(row).toBeVisible();

    await narrate('Confirm - the coach vanishes from the roster');
    await row.getByRole('button', { name: `Remove ${coachName}` }).click();
    await dialog.getByRole('button', { name: 'Remove coach' }).click();
    await expect(dialog).toBeHidden();
    const toast = page.getByRole('status').filter({ hasText: `${coachName} was removed from your organisation.` });
    await expect(toast).toBeVisible();
    await highlight(toast);
    await expect(row).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole('table', { name: 'Coach roster' }).getByRole('row').filter({ hasText: coach.email })).toHaveCount(0);

    await narrate('Consequences: the coach is signed out everywhere and no longer acts for the trainer');
    const stale = await api.get('/me', { auth: coach.session });
    expect(stale.status).toBe(401);
    const refreshed = await api.refresh(coach.session).catch((e: unknown) => e);
    expect(refreshed).toBeInstanceOf(Error);

    await narrate('History is kept: soft removal, the profile and account rows still exist (status INACTIVE)');
    const profile = await sql(`SELECT status, "trainerId" FROM "CoachProfile" WHERE id = $1`, [coach.coachId]);
    expect(profile.rows).toHaveLength(1);
    expect(profile.rows[0]).toMatchObject({ status: 'INACTIVE', trainerId: trainer.trainerId });
    const user = await sql(`SELECT status, "deletedAt" FROM "User" WHERE id = $1`, [coach.userId]);
    expect(user.rows[0].deletedAt).toBeNull();
    const gone = await api.get(`/trainers/${trainer.trainerId}/coaches`, { auth: trainer.session });
    expect(JSON.stringify(gone.body)).not.toContain(coach.email);
  });

  test('removes a player from the roster: the family keeps its profile, history is kept, and the family can rejoin with the link', async ({
    page,
    api,
    mailbox,
    narrate,
    loginAs,
  }) => {
    const trainer = await createTrainer(api, mailbox);
    const kidName = `Remy ${uniqueName('Kid').lastName}`;
    const parent = await createParentWithChildren(api, trainer, [kidName]);
    const kid = parent.children[0];
    const row = page.getByRole('table', { name: 'Player roster' }).getByRole('row').filter({ hasText: kidName });

    await narrate('Trainer signs in and opens the player roster');
    await loginAs(trainer.email, trainer.password);
    await shell(page).goTo('Players');
    await expect(row).toBeVisible();

    await narrate('Remove the player: the dialog explains soft removal');
    await row.getByRole('button', { name: `Remove ${kidName}` }).click();
    const dialog = page.getByRole('dialog', { name: 'Remove player' });
    await expect(dialog).toContainText(`${kidName} will be removed from your roster.`);
    await expect(dialog).toContainText('their history is kept');
    await expect(dialog).toContainText('rejoin later with a share link');
    await highlight(dialog);

    await dialog.getByRole('button', { name: 'Remove player' }).click();
    await expect(dialog).toBeHidden();
    const toast = page.getByRole('status').filter({ hasText: `${kidName} was removed from your roster.` });
    await expect(toast).toBeVisible();
    await highlight(toast);
    await expect(row).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole('table', { name: 'Player roster' }).getByRole('row').filter({ hasText: kidName })).toHaveCount(0);

    await narrate('History is kept: the association row is marked INACTIVE, not deleted, and the profile still exists');
    const assoc = await sql(`SELECT status, "disconnectedAt" FROM "PlayerTrainerAssociation" WHERE "playerProfileId" = $1 AND "trainerId" = $2`, [
      kid.id,
      trainer.trainerId,
    ]);
    expect(assoc.rows).toHaveLength(1);
    expect(assoc.rows[0].status).toBe('INACTIVE');
    expect(assoc.rows[0].disconnectedAt).not.toBeNull();
    const profile = await sql(`SELECT "deletedAt" FROM "PlayerProfile" WHERE id = $1`, [kid.id]);
    expect(profile.rows[0].deletedAt).toBeNull();

    await narrate('The family still has the child profile, now with no trainer connection');
    const family = await api.get<Array<{ id: string; trainerCount?: number }>>('/player-profiles', { auth: parent.session });
    expect(family.body.find((p) => p.id === kid.id)?.trainerCount ?? 0).toBe(0);

    await narrate("The family rejoins with the trainer's share link: the player is on the roster again");
    await connectProfilesViaLink(api, parent, parent.code, [kid.id]);
    await page.reload();
    await expect(page.getByRole('table', { name: 'Player roster' }).getByRole('row').filter({ hasText: kidName })).toBeVisible();
    await highlight(page.getByRole('table', { name: 'Player roster' }).getByRole('row').filter({ hasText: kidName }));
  });
});

test.describe('Super Admin trainer set-up e-mail and audit', () => {
  test('"Resend setup email" is only offered while setup is open; the new link works and the old one is dead', async ({
    page,
    api,
    mailbox,
    seed,
    narrate,
    loginAs,
  }) => {
    const admin = await api.superAdmin();
    const completed = await createTrainer(api, mailbox);
    const email = uniqueEmail('pending');
    const { firstName, lastName } = uniqueName('Pending');
    const created = await api.post<{ id: string; userId: string }>('/trainers', {
      auth: admin,
      body: { businessName: `${lastName} Academy`, firstName, lastName, email, phone: validPhone() },
    });
    expect(created.status).toBe(201);
    const oldLink = await mailbox.linkTo(email, /register\?token=/);

    await narrate('A trainer who finished setup has no "Resend setup email" button');
    await loginAs(seed.superAdmin.email, seed.superAdmin.password);
    await openUserCard(page, completed.email, `${completed.firstName} ${completed.lastName}`);
    await expect(page.getByRole('button', { name: 'Deactivate user' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Resend setup email' })).toHaveCount(0);

    await narrate('A trainer who has NOT set up yet has it');
    await openUserCard(page, email, `${firstName} ${lastName}`);
    const resend = page.getByRole('button', { name: 'Resend setup email' });
    await expect(resend).toBeVisible();
    await highlight(resend);

    await narrate('Click it: a toast confirms and a second invitation arrives');
    await resend.click();
    const toast = page.getByRole('status').filter({ hasText: `Setup email sent to ${email}.` });
    await expect(toast).toBeVisible();
    await highlight(toast);
    await expect
      .poll(async () => (await mailbox.list(email)).filter((m) => /complete your trainer account setup/i.test(m.subject)).length, { timeout: 30_000 })
      .toBe(2);
    const mails = (await mailbox.list(email)).filter((m) => /complete your trainer account setup/i.test(m.subject));
    const newLink = mails[mails.length - 1].links.find((l) => /register\?token=/.test(l));
    expect(newLink).toBeTruthy();
    expect(newLink).not.toBe(oldLink);

    await narrate('Sign out; the OLD setup link no longer works');
    await shell(page).signOut();
    await expect(page).toHaveURL(/\/login/);
    await page.goto(oldLink);
    await page.getByLabel('Choose a password').fill(strongPassword());
    await page.getByRole('button', { name: 'Complete setup' }).click();
    const dead = page.getByRole('alert').filter({ hasText: 'This link is invalid or has expired.' });
    await expect(dead).toBeVisible();
    await highlight(dead);

    await narrate('The NEW setup link completes the account');
    await page.goto(newLink!);
    await page.getByLabel('Choose a password').fill(strongPassword());
    await page.getByRole('button', { name: 'Complete setup' }).click();
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 });
    await expect(page.getByRole('heading', { name: `Welcome, ${firstName}` })).toBeVisible();

    await narrate('Once set up, the API refuses another resend (409) - the button disappears');
    const again = await api.post(`/trainers/by-user/${created.body.userId}/resend-setup`, { auth: admin });
    expect(again.status).toBe(409);
  });

  test('creating a trainer in the UI writes an audit record (who, when, trainer details)', async ({ page, api, seed, narrate, loginAs }) => {
    const admin = await api.superAdmin();
    const email = uniqueEmail('audited');
    const { firstName, lastName } = uniqueName('Audit');
    const businessName = `${lastName} Training Co`;

    await narrate('Super Admin creates a trainer through the Create Trainer dialog');
    await loginAs(seed.superAdmin.email, seed.superAdmin.password);
    await shell(page).goTo('Users');
    await page.getByRole('button', { name: 'Create Trainer' }).click();
    const dialog = page.getByRole('dialog', { name: 'Create Trainer' });
    await dialog.getByLabel('Business name').fill(businessName);
    await dialog.getByLabel('First name').fill(firstName);
    await dialog.getByLabel('Last name').fill(lastName);
    await dialog.getByLabel('Email').fill(email);
    await dialog.getByLabel('Phone').fill(validPhone().replace('+1', ''));
    await dialog.getByRole('button', { name: 'Create trainer' }).click();
    await expect(dialog).toBeHidden();
    await page.getByLabel('Search').fill(email);
    await expect(page.getByRole('table', { name: 'Users' }).getByRole('row', { name: `${firstName} ${lastName}` })).toBeVisible();

    await narrate('The audit table has exactly one row for it: creator, trainer, business, e-mail, timestamp');
    const audit = await sql(
      `SELECT "createdByUserId", "trainerUserId", "trainerProfileId", "businessName", email,
              extract(epoch from ((now() at time zone 'utc') - "createdAt")) AS "ageSeconds"
         FROM audit."TrainerCreationLog" WHERE email = $1`,
      [email],
    );
    expect(audit.rows).toHaveLength(1);
    const row = audit.rows[0];
    expect(row.createdByUserId).toBe(admin.user.id);
    expect(row.businessName).toBe(businessName);
    expect(row.email).toBe(email);
    expect(Math.abs(Number(row.ageSeconds))).toBeLessThan(300); // written just now

    const user = await sql(`SELECT id FROM "User" WHERE email = $1`, [email]);
    expect(row.trainerUserId).toBe(user.rows[0].id);
    const profile = await sql(`SELECT id, "businessName" FROM "TrainerProfile" WHERE "userId" = $1`, [user.rows[0].id]);
    expect(row.trainerProfileId).toBe(profile.rows[0].id);

    await narrate('A rejected duplicate creates no second audit row');
    const dup = await api.post('/trainers', { auth: admin, body: { businessName, firstName, lastName, email, phone: validPhone() } });
    expect(dup.status).toBeGreaterThanOrEqual(400);
    const after = await sql(`SELECT count(*)::int AS n FROM audit."TrainerCreationLog" WHERE email = $1`, [email]);
    expect(after.rows[0].n).toBe(1);
  });
});

test.describe('Player / parent edits an existing player profile (US-01.11)', () => {
  test("parent edits a child's school, jersey number and emergency contact; validation; values persist after reload", async ({
    page,
    api,
    mailbox,
    narrate,
    loginAs,
  }) => {
    const trainer = await createTrainer(api, mailbox);
    const kidName = `Quinn ${uniqueName('Kid').lastName}`;
    const parent = await createParentWithChildren(api, trainer, [kidName]);
    const kid = parent.children[0];

    await narrate("Parent signs in and opens the child's profile");
    await loginAs(parent.email, parent.password);
    await shell(page).goTo('Profiles');
    await page.getByRole('link', { name: kidName }).click();
    await expect(page.getByRole('heading', { name: kidName, level: 1 })).toBeVisible();
    await expect(page.getByLabel('School')).toHaveValue('');
    await expect(page.getByLabel('Jersey number')).toHaveValue('');

    await narrate('Validation: jersey number format, and an emergency contact needs BOTH name and phone');
    await page.getByLabel('Jersey number').fill('#7!');
    await page.getByLabel('Contact name').fill('Dana Reed');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Jersey number can only contain letters, numbers and hyphens.')).toBeVisible();
    await expect(page.getByText('Enter a contact phone number, or clear the name.')).toBeVisible();
    await highlight(page.getByText('Enter a contact phone number, or clear the name.'));

    await narrate('Fill in school, jersey number and the emergency contact');
    await page.getByLabel('School').fill('Lincoln Elementary School');
    await page.getByLabel('Jersey number').fill('23-B');
    await page.getByLabel('Contact name').fill('Dana Reed');
    await page.getByLabel('Contact phone').fill('2025550123');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    const saved = page.getByRole('status').filter({ hasText: 'Profile saved.' });
    await expect(saved).toBeVisible();
    await highlight(saved);

    await narrate('Reload: everything is still there');
    await page.reload();
    await expect(page.getByLabel('School')).toHaveValue('Lincoln Elementary School');
    await expect(page.getByLabel('Jersey number')).toHaveValue('23-B');
    await expect(page.getByLabel('Contact name')).toHaveValue('Dana Reed');
    await expect(page.getByLabel('Contact phone')).toHaveValue(/555-0123/);
    await highlight(page.getByRole('group', { name: 'Emergency contact' }));

    const stored = await api.get<{ school: string; jerseyNumber: string; emergencyContact: { name: string; phone: string } }>(`/player-profiles/${kid.id}`, {
      auth: parent.session,
    });
    expect(stored.body).toMatchObject({
      school: 'Lincoln Elementary School',
      jerseyNumber: '23-B',
      emergencyContact: { name: 'Dana Reed', phone: '+12025550123' },
    });

    await narrate('Edit again: change the jersey number and swap the contact');
    await page.getByLabel('Jersey number').fill('9');
    await page.getByLabel('Contact name').fill('Sam Ortiz');
    await page.getByLabel('Contact phone').fill('2025550166');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Profile saved.' })).toBeVisible();
    await page.reload();
    await expect(page.getByLabel('Jersey number')).toHaveValue('9');
    await expect(page.getByLabel('Contact name')).toHaveValue('Sam Ortiz');
    await expect(page.getByLabel('School')).toHaveValue('Lincoln Elementary School');
  });

  test('an adult player edits their own ("Me") profile: school, jersey number, emergency contact', async ({ page, api, mailbox, narrate, loginAs }) => {
    const trainer = await createTrainer(api, mailbox);
    const code = await createPlayerLinkCode(api, trainer);
    const player = await registerParent(api, code, { isSelf: true });
    const own = player.profiles.find((p) => p.isSelf)!;

    await narrate('A player who trains themselves opens their own profile');
    await loginAs(player.email, player.password);
    await page.goto(`/profiles/${own.id}`);
    await expect(page.getByRole('heading', { name: own.name, level: 1 })).toBeVisible();

    await narrate('Add school, jersey number and an emergency contact');
    await page.getByLabel('School').fill('Roosevelt High');
    await page.getByLabel('Jersey number').fill('11');
    await page.getByLabel('Contact name').fill('Alex Parent');
    await page.getByLabel('Contact phone').fill('2025550144');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Profile saved.' })).toBeVisible();

    await narrate('Clearing the optional fields persists too');
    await page.reload();
    await expect(page.getByLabel('School')).toHaveValue('Roosevelt High');
    await page.getByLabel('School').fill('');
    await page.getByLabel('Jersey number').fill('');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Profile saved.' })).toBeVisible();
    await page.reload();
    await expect(page.getByLabel('School')).toHaveValue('');
    await expect(page.getByLabel('Jersey number')).toHaveValue('');
    await expect(page.getByLabel('Contact name')).toHaveValue('Alex Parent');
  });
});
