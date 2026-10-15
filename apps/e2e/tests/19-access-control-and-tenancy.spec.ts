import {
  test,
  expect,
  highlight,
  shell,
  createTrainer,
  createCoach,
  createPlayer,
  type CoachFixture,
  type PlayerFixture,
  type TrainerFixture,
} from '../support/test';

/**
 * Epic-01 section 9 (role-based access, multi-tenancy) / section 10 acceptance criteria:
 * "Users cannot access features outside their permissions", "0% data leakage between trainer organisations",
 * "permissions enforced on both frontend (UI) and backend (API)".
 */
test.describe('Role-based access control and tenant isolation', () => {
  const ADMIN_ROUTES = ['/users', '/impersonation-history'];
  const TRAINER_ROUTES = ['/coaches', '/players', '/share-links', '/branding'];
  const COACH_ROUTES = ['/my-times', '/profile'];
  const PLAYER_ROUTES = ['/profiles', '/approvals'];

  async function expectBouncedToDashboard(page: import('@playwright/test').Page, routes: string[], narrate: (t: string) => Promise<void>, who: string) {
    for (const route of routes) {
      await narrate(`${who} opens ${route} directly -> sent back to their own dashboard`);
      await page.goto(route);
      await expect(page).toHaveURL(/\/dashboard$/, { timeout: 20_000 });
    }
  }

  test('anonymous visitors are sent to /login from every protected area', async ({ page, narrate }) => {
    for (const route of [...ADMIN_ROUTES, ...TRAINER_ROUTES, ...COACH_ROUTES, '/dashboard', '/account/profile']) {
      await narrate(`Anonymous -> ${route}`);
      await page.goto(route);
      await expect(page).toHaveURL(/\/login/, { timeout: 20_000 });
    }
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  });

  test('each role only sees its own navigation and is redirected away from the other roles\' routes', async ({
    page,
    api,
    mailbox,
    seed,
    narrate,
    loginAs,
  }) => {
    const trainer = await createTrainer(api, mailbox);
    const coach = await createCoach(api, mailbox, trainer);
    const player = await createPlayer(api, trainer);
    const app = shell(page);

    // --- Super Admin
    await narrate('SUPER ADMIN: admin navigation only');
    await loginAs(seed.superAdmin.email, seed.superAdmin.password);
    for (const label of ['Dashboard', 'Users', 'Impersonation History', 'Account']) await expect(app.navLink(label)).toBeVisible();
    for (const label of ['Coaches', 'Players', 'Share Links', 'Branding', 'My Times', 'Profiles']) await expect(app.navLink(label)).toHaveCount(0);
    await highlight(app.nav);
    await expectBouncedToDashboard(page, [...TRAINER_ROUTES, ...COACH_ROUTES, ...PLAYER_ROUTES], narrate, 'Super Admin');
    await expect(page.getByText('Super Admin dashboard')).toBeVisible();
    await app.signOut();

    // --- Trainer
    await narrate('TRAINER: trainer navigation only');
    await loginAs(trainer.email, trainer.password);
    for (const label of ['Dashboard', 'Coaches', 'Players', 'Share Links', 'Branding', 'Account']) await expect(app.navLink(label)).toBeVisible();
    for (const label of ['Users', 'Impersonation History', 'My Times', 'Profiles']) await expect(app.navLink(label)).toHaveCount(0);
    await highlight(app.nav);
    await expectBouncedToDashboard(page, [...ADMIN_ROUTES, ...COACH_ROUTES, ...PLAYER_ROUTES], narrate, 'Trainer');
    await app.signOut();

    // --- Coach
    await narrate('COACH: coach navigation only');
    await loginAs(coach.email, coach.password);
    for (const label of ['Dashboard', 'My Times', 'Profile', 'Account']) await expect(app.navLink(label)).toBeVisible();
    for (const label of ['Users', 'Coaches', 'Players', 'Branding', 'Profiles']) await expect(app.navLink(label)).toHaveCount(0);
    await highlight(app.nav);
    await expectBouncedToDashboard(page, [...ADMIN_ROUTES, ...TRAINER_ROUTES, ...PLAYER_ROUTES], narrate, 'Coach');
    await app.signOut();

    // --- Player / parent
    await narrate('PLAYER / PARENT: player navigation only');
    await loginAs(player.email, player.password);
    for (const label of ['Dashboard', 'Profiles', 'Account']) await expect(app.navLink(label)).toBeVisible();
    for (const label of ['Users', 'Coaches', 'Branding', 'My Times']) await expect(app.navLink(label)).toHaveCount(0);
    await highlight(app.nav);
    await expectBouncedToDashboard(page, [...ADMIN_ROUTES, ...TRAINER_ROUTES, ...COACH_ROUTES], narrate, 'Player');
  });

  test('API enforces roles server-side: wrong role -> 403, no token -> 401', async ({ api, mailbox, narrate, page }) => {
    const trainer = await createTrainer(api, mailbox);
    const coach = await createCoach(api, mailbox, trainer);
    const player = await createPlayer(api, trainer);
    await page.goto('/login');
    await narrate('Anonymous requests are refused (401)');
    for (const path of ['/users', '/me', '/me/bootstrap', `/trainers/${trainer.trainerId}/coaches`]) {
      expect((await api.get(path)).status, `GET ${path} without token`).toBe(401);
    }

    await narrate('Only a Super Admin may list users, create trainers, impersonate or read the deletion log');
    for (const [who, session] of [['trainer', trainer.session], ['coach', coach.session], ['player', player.session]] as const) {
      expect((await api.get('/users', { auth: session })).status, `${who} GET /users`).toBe(403);
      expect((await api.get('/users/deletion-log', { auth: session })).status, `${who} deletion-log`).toBe(403);
      expect(
        (await api.post('/trainers', { auth: session, body: { businessName: 'X', firstName: 'X', lastName: 'X', email: 'x@e2e.test', phone: '+14155552671' } })).status,
        `${who} POST /trainers`,
      ).toBe(403);
    }

    await narrate('Trainer-only actions are refused for a coach and a player');
    expect((await api.post('/coaches/invite', { auth: coach.session, body: { email: 'new@e2e.test' } })).status).toBe(403);
    expect((await api.post('/coaches/invite', { auth: player.session, body: { email: 'new@e2e.test' } })).status).toBe(403);
    expect((await api.post('/share-links', { auth: coach.session, body: { type: 'PLAYER_STATIC' } })).status).toBe(403);
    expect((await api.patch(`/trainers/${trainer.trainerId}/branding`, { auth: coach.session, body: { primaryColorHex: '#112233' } })).status).toBe(403);

    await narrate('Every role can read its own profile (200)');
    for (const session of [trainer.session, coach.session, player.session]) {
      expect((await api.get('/me', { auth: session })).status).toBe(200);
    }
    void page;
  });

  test('tenant isolation (API): trainer A cannot read or change trainer B\'s coaches, players, share links or branding', async ({
    api,
    mailbox,
    narrate,
    page,
  }) => {
    const a = await createTrainer(api, mailbox);
    const b = await createTrainer(api, mailbox);
    const coachB = await createCoach(api, mailbox, b);
    const playerB = await createPlayer(api, b);
    void playerB;
    await page.goto('/login');

    await narrate('A reads its OWN roster fine (200)...');
    expect((await api.get(`/trainers/${a.trainerId}/coaches`, { auth: a.session })).status).toBe(200);
    expect((await api.get(`/trainers/${a.trainerId}/players`, { auth: a.session })).status).toBe(200);

    await narrate('...but B\'s resources are invisible: 404 (never even confirming they exist)');
    for (const path of [
      `/trainers/${b.trainerId}`,
      `/trainers/${b.trainerId}/coaches`,
      `/trainers/${b.trainerId}/players`,
      `/trainers/${b.trainerId}/share-links`,
      `/coaches/${coachB.coachId}/availability`,
    ]) {
      const res = await api.get(path, { auth: a.session });
      expect([403, 404], `A GET ${path} -> ${res.status}`).toContain(res.status);
    }
    const patch = await api.patch(`/trainers/${b.trainerId}`, { auth: a.session, body: { businessName: 'Hijacked' } });
    expect([403, 404]).toContain(patch.status);
    const branding = await api.patch(`/trainers/${b.trainerId}/branding`, { auth: a.session, body: { primaryColorHex: '#FF0000' } });
    expect([403, 404]).toContain(branding.status);
    const removeCoach = await api.delete(`/coaches/${coachB.coachId}`, { auth: a.session });
    expect([403, 404]).toContain(removeCoach.status);
    const override = await api.post(`/coaches/${coachB.coachId}/availability/override`, {
      auth: a.session,
      body: { eventId: crypto.randomUUID(), reason: 'trying to cross tenants' },
    });
    expect([403, 404]).toContain(override.status);

    await narrate('B\'s data is untouched');
    const bProfile = await api.get<{ businessName: string; primaryColorHex: string | null }>(`/trainers/${b.trainerId}`, { auth: b.session });
    expect(bProfile.body.businessName).toBe(b.businessName);
    expect(bProfile.body.primaryColorHex).toBeNull();

    await narrate('A coach can only act inside their own organisation either');
    const coachBRead = await api.get(`/trainers/${a.trainerId}/coaches`, { auth: coachB.session });
    expect([403, 404]).toContain(coachBRead.status);
  });

  test('tenant isolation (UI): each trainer\'s Coaches and Players pages list only their own people', async ({ page, api, mailbox, narrate, loginAs }) => {
    const a: TrainerFixture = await createTrainer(api, mailbox);
    const b: TrainerFixture = await createTrainer(api, mailbox);
    const coachA: CoachFixture = await createCoach(api, mailbox, a);
    const coachB: CoachFixture = await createCoach(api, mailbox, b);
    const playerA: PlayerFixture = await createPlayer(api, a);
    const playerB: PlayerFixture = await createPlayer(api, b);
    const app = shell(page);

    await narrate('Trainer A: sees coach A and player A only');
    await loginAs(a.email, a.password);
    await app.goTo('Coaches');
    const coachTable = page.getByRole('table', { name: 'Coach roster' });
    await expect(coachTable.getByText(coachA.email)).toBeVisible();
    await expect(coachTable.getByText(coachB.email)).toHaveCount(0);
    await highlight(coachTable);
    await app.goTo('Players');
    const playerTable = page.getByRole('table', { name: 'Player roster' });
    await expect(playerTable.getByRole('row', { name: `${playerA.firstName} ${playerA.lastName}` })).toBeVisible();
    await expect(playerTable.getByRole('row', { name: `${playerB.firstName} ${playerB.lastName}` })).toHaveCount(0);
    await highlight(playerTable);
    await app.signOut();

    await narrate('Trainer B: the mirror image');
    await loginAs(b.email, b.password);
    await app.goTo('Coaches');
    await expect(page.getByRole('table', { name: 'Coach roster' }).getByText(coachB.email)).toBeVisible();
    await expect(page.getByRole('table', { name: 'Coach roster' }).getByText(coachA.email)).toHaveCount(0);
    await app.goTo('Players');
    await expect(page.getByRole('table', { name: 'Player roster' }).getByRole('row', { name: `${playerB.firstName} ${playerB.lastName}` })).toBeVisible();
    await expect(page.getByRole('table', { name: 'Player roster' }).getByRole('row', { name: `${playerA.firstName} ${playerA.lastName}` })).toHaveCount(0);
  });
});
