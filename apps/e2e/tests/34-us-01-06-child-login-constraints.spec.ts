import {
  test,
  expect,
  highlight,
  shell,
  createTrainer,
  createPlayerLinkCode,
  registerParent,
  addChildProfile,
  connectProfilesViaLink,
  createChildLogin,
  showEmail,
  uniqueName,
  type ApiClient,
} from '../support/test';

/**
 * US-01.06 - Child login with constraints.
 * A child signs in with their own login but cannot approve purchases, add/remove trainers, edit parental controls, manage children,
 * and cannot register through a ShareLink (the guardian is e-mailed instead). The API answers 403 CHILD_CAPABILITY_DENIED.
 * (Payment methods, token purchase and account deletion do not exist in the Epic-01 UI: only their absence can be shown.)
 */
test.describe('US-01.06: Child login with constraints', () => {
  async function family(api: ApiClient, mailbox: Parameters<typeof createTrainer>[1]) {
    const trainerA = await createTrainer(api, mailbox);
    const trainerB = await createTrainer(api, mailbox);
    const parent = await registerParent(api, await createPlayerLinkCode(api, trainerA), { isSelf: true });
    const kid = await addChildProfile(api, parent, { name: `Kai ${uniqueName('Kid').lastName}`, trainerIds: [trainerA.trainerId], school: 'Oak School' });
    const sibling = await addChildProfile(api, parent, { name: `Sia ${uniqueName('Kid').lastName}`, trainerIds: [trainerA.trainerId] });
    const login = await createChildLogin(api, parent, kid);
    return { trainerA, trainerB, parent, kid, sibling, login };
  }

  const FORBIDDEN_TEXT = /payment method|purchase tokens|buy tokens|delete (my )?account/i;

  test('child portal: no Approvals, no add/remove trainer, no child management, no parental controls - but own basics stay editable', async ({
    page,
    api,
    mailbox,
    narrate,
    loginAs,
  }) => {
    const { trainerA, parent, kid, sibling, login } = await family(api, mailbox);

    await narrate('The child signs in with their own login');
    await loginAs(login.email, login.password);
    await expect(page.getByTestId('context-switcher-current')).toHaveText(trainerA.businessName);

    await narrate('Navigation: Dashboard, Profiles, My requests - and no Approvals');
    const app = shell(page);
    for (const label of ['Dashboard', 'Profiles', 'My requests']) await expect(app.navLink(label)).toBeVisible();
    await expect(app.navLink('Approvals')).toHaveCount(0);
    await expect(page.getByRole('link', { name: /Pending Approvals/ })).toHaveCount(0);
    await highlight(app.sidebar);

    await narrate('Opening /approvals directly bounces the child back to the dashboard (the API denies it)');
    await page.goto('/approvals');
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 });

    await narrate('Profiles: the child sees only their own profile - no "+ Add Child", no "Add myself", no parent, no sibling');
    await app.goTo('Profiles');
    await expect(page.getByRole('link', { name: kid.name })).toBeVisible();
    await expect(page.getByRole('link', { name: sibling.name })).toHaveCount(0);
    await expect(page.getByRole('link', { name: parent.profiles[0].name })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '+ Add Child' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Add myself as a player' })).toHaveCount(0);
    await highlight(page.getByRole('link', { name: kid.name }));

    await narrate('Own profile: trainers are visible read-only - no "Add Trainer", no "Remove"');
    await page.getByRole('link', { name: kid.name }).click();
    await expect(page.getByRole('heading', { name: kid.name, level: 1 })).toBeVisible();
    await expect(page.getByRole('row', { name: trainerA.businessName })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add Trainer' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Remove' })).toHaveCount(0);
    await narrate('No "Child login" card and no parental control for token spending');
    await expect(page.locator('[aria-label="Child login"]')).toHaveCount(0);
    await expect(page.getByLabel('Allow this player to spend tokens without approval')).toHaveCount(0);
    await highlight(page.getByRole('table', { name: 'Trainer associations' }));

    await narrate('Basic profile info can be updated by the child (school)');
    await page.getByLabel('School').fill('Maple Middle School');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect.poll(async () => (await api.get<{ school: string }>(`/player-profiles/${kid.id}`, { auth: login.session })).body.school).toBe('Maple Middle School');

    await narrate('Nothing about payment methods, buying tokens or deleting the account is offered');
    for (const route of ['/dashboard', '/profiles', `/profiles/${kid.id}`, '/requests']) {
      await page.goto(route);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expect(page.getByText(FORBIDDEN_TEXT)).toHaveCount(0);
    }

    await narrate('The sibling\'s and the parent\'s data are not reachable either');
    await page.goto(`/profiles/${sibling.id}`);
    await expect(page.getByRole('alert').filter({ hasText: 'Something went wrong loading this profile.' })).toBeVisible();
    await expect(page.getByText(sibling.name)).toHaveCount(0);
  });

  test('API: forbidden endpoints answer 403 CHILD_CAPABILITY_DENIED (and parental fields CHILD_FIELD_NOT_EDITABLE)', async ({ page, api, mailbox, narrate, loginAs }) => {
    const { trainerB, parent, kid, sibling, login } = await family(api, mailbox);
    const child = login.session;
    const bCode = await createPlayerLinkCode(api, trainerB);
    const deniedBody = (res: { body: unknown }) => (res.body as { errorCode?: string }).errorCode;

    await narrate('A child token calls endpoints that are parent-only');
    await loginAs(login.email, login.password);
    await page.goto('/dashboard');

    const attempts: Array<[string, () => ReturnType<ApiClient['request']>]> = [
      ['create a child profile', () => api.post('/player-profiles', { auth: child, body: { name: 'Hacker Kid', dateOfBirth: '2016-01-01', gender: 'MALE' } })],
      ['add a trainer', () => api.post(`/player-profiles/${kid.id}/trainers`, { auth: child, body: { trainerId: trainerB.trainerId } })],
      ['add a trainer by ShareLink code', () => api.post(`/player-profiles/${kid.id}/trainers`, { auth: child, body: { shareLinkCode: bCode } })],
      ['remove a trainer', () => api.delete(`/player-profiles/${kid.id}/trainers/${trainerB.trainerId}`, { auth: child })],
      ['list approvals', () => api.get('/approvals', { auth: child })],
      ['approve a purchase', () => api.post('/approvals/00000000-0000-4000-8000-000000000000/approve', { auth: child, body: {} })],
      ['deny a purchase', () => api.post('/approvals/00000000-0000-4000-8000-000000000000/deny', { auth: child, body: {} })],
      ['create a child login', () => api.post(`/player-profiles/${kid.id}/child-login`, { auth: child, body: { email: 'x@e2e.test', password: 'Passw0rd!x' } })],
    ];
    for (const [what, call] of attempts) {
      const res = await call();
      expect(res.status, `child must not ${what}`).toBe(403);
      expect(deniedBody(res), `child must not ${what}`).toBe('CHILD_CAPABILITY_DENIED');
    }

    await narrate('Parental controls cannot be changed by the child, even on their own profile');
    const flag = await api.patch(`/player-profiles/${kid.id}`, { auth: child, body: { allowChildTokenSpendWithoutApproval: true } });
    expect(flag.status).toBe(403);
    expect(deniedBody(flag)).toBe('CHILD_FIELD_NOT_EDITABLE');
    expect((await api.get<{ allowChildTokenSpendWithoutApproval: boolean }>(`/player-profiles/${kid.id}`, { auth: parent.session })).body.allowChildTokenSpendWithoutApproval).toBe(false);

    await narrate('A ShareLink cannot be used by a child (guardian is notified instead)');
    const redeem = await api.post(`/share-links/${bCode}/redeem`, { auth: child, body: { subjectProfileIds: [kid.id] } });
    expect(redeem.status).toBe(403);
    expect(['CHILD_SHARE_LINK_BLOCKED', 'CHILD_CAPABILITY_DENIED']).toContain(deniedBody(redeem));

    await narrate('Other family data is invisible to the child (404) - only the own profile is listed');
    expect((await api.get(`/player-profiles/${sibling.id}`, { auth: child })).status).toBe(404);
    const own = await api.get<Array<{ id: string }>>('/player-profiles', { auth: child });
    expect(own.body.map((p) => p.id)).toEqual([kid.id]);

    await narrate('What a child CAN do still works: read own profile and own requests; a parent cannot create purchase requests');
    expect((await api.get(`/player-profiles/${kid.id}`, { auth: child })).status).toBe(200);
    expect((await api.get('/me/purchase-requests', { auth: child })).status).toBe(200);
    expect((await api.post('/me/purchase-requests', { auth: parent.session, body: { title: 't', amountCents: 100, currency: 'USD', paymentType: 'USD' } })).status).toBe(403);
    await highlight(page.getByRole('heading', { level: 1 }));
  });

  test('ShareLink blocking: the child is told to ask a parent, the guardian gets "wants to join" e-mail with "Review Registration", the child is NOT associated', async ({
    page,
    api,
    mailbox,
    narrate,
    loginAs,
  }) => {
    const { trainerA, trainerB, parent, kid, login } = await family(api, mailbox);
    const codeB = await createPlayerLinkCode(api, trainerB);

    await narrate('The child (logged in) opens trainer B\'s ShareLink');
    await loginAs(login.email, login.password);
    await page.goto(`/join/${codeB}`);
    await expect(page.getByRole('heading', { name: `Join ${trainerB.businessName}` })).toBeVisible();
    const notice = page.getByRole('alert').filter({ hasText: 'Ask your parent to register you with this trainer.' });
    await expect(notice).toBeVisible();
    await expect(page.getByLabel('Password', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Connect' })).toHaveCount(0);
    await highlight(notice);

    await narrate('The parent is e-mailed: "[Child] wants to join [Trainer]\'s program" with a "Review Registration" button');
    const mail = await mailbox.waitFor(parent.email, { subject: `${kid.name} wants to join ${trainerB.businessName}'s program` });
    expect(mail.html).toContain('>Review Registration</a>');
    expect(mail.text).toContain(kid.name);
    const reviewLink = mail.links.find((l) => l.includes(`/join/${codeB}`));
    expect(reviewLink).toBeTruthy();
    await showEmail(page, mail, 2200);

    await narrate('The child was NOT associated with trainer B');
    const trainers = await api.get<Array<{ trainerId: string }>>(`/player-profiles/${kid.id}/trainers`, { auth: login.session });
    expect(trainers.body.map((t) => t.trainerId)).toEqual([trainerA.trainerId]);
    await page.goto('/dashboard');
    const select = page.getByRole('combobox', { name: 'Active trainer context' });
    await expect(select.getByRole('option')).toHaveCount(1);
    await expect(select.getByRole('option', { name: trainerB.businessName })).toHaveCount(0);

    await narrate('The parent follows "Review Registration", picks the child and completes the registration');
    await shell(page).signOut();
    await loginAs(parent.email, parent.password);
    await page.goto(reviewLink!);
    await expect(page.getByText(`Who will train with ${trainerB.businessName}?`)).toBeVisible();
    await page.getByLabel(kid.name).check();
    await page.getByRole('button', { name: 'Connect' }).click();
    await expect(page.getByRole('status').filter({ hasText: `Connected with ${trainerB.businessName}` })).toBeVisible();

    await narrate('Only now the child has trainer B');
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 });
    await expect
      .poll(async () => (await api.get<Array<{ trainerId: string }>>(`/player-profiles/${kid.id}/trainers`, { auth: parent.session })).body.map((t) => t.trainerId).sort())
      .toEqual([trainerA.trainerId, trainerB.trainerId].sort());
  });

  test('the child\'s context selector shows only the child\'s own trainers (not the parent\'s or the sibling\'s)', async ({ page, api, mailbox, narrate, loginAs }) => {
    const { trainerA, trainerB, parent, kid, sibling, login } = await family(api, mailbox);
    const trainerC = await createTrainer(api, mailbox);
    // sibling also trains with B, the parent herself with C - neither belongs to Kai
    await connectProfilesViaLink(api, parent, await createPlayerLinkCode(api, trainerB), [sibling.id]);
    await connectProfilesViaLink(api, parent, await createPlayerLinkCode(api, trainerC), [parent.profiles[0].id]);

    await narrate('The parent sees all three trainers across the family');
    await loginAs(parent.email, parent.password);
    const select = page.getByRole('combobox', { name: 'Active trainer context' });
    for (const t of [trainerA, trainerB, trainerC]) await expect(select.getByRole('option', { name: new RegExp(t.businessName) }).first()).toBeAttached();
    await highlight(select);

    await narrate('Kai (child login) sees only trainer A - his own');
    await shell(page).signOut();
    await loginAs(login.email, login.password);
    await expect(select.getByRole('option')).toHaveCount(1);
    await expect(select.getByRole('option', { name: trainerA.businessName, exact: true })).toHaveCount(1);
    await expect(page.getByText(trainerB.businessName)).toHaveCount(0);
    await expect(page.getByText(trainerC.businessName)).toHaveCount(0);
    await expect(page.getByText(sibling.name)).toHaveCount(0);
    await expect(page.getByText(`Your Training: ${trainerA.businessName}`)).toBeVisible();
    await highlight(select);
  });
});
