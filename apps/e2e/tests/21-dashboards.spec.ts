import {
  test,
  expect,
  highlight,
  shell,
  createTrainer,
  createCoach,
  createPlayer,
  uniqueEmail,
  type ApiSession,
} from '../support/test';
import type { ApiClient } from '../support/api';
import type { Page } from '@playwright/test';

/**
 * Epic-01 dashboards: every role lands on its own dashboard with role-specific metric cards
 * (GET /dashboard/stats) and a row of quick-link cards that navigate to the right pages.
 */
interface Metric {
  key: string;
  label: string;
  value: number;
  unit?: 'count' | 'percent' | 'hours';
}

const fmt = (value: number) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(value);

async function fetchMetrics(api: ApiClient, session: ApiSession): Promise<Metric[]> {
  const res = await api.get<{ metrics: Metric[] }>('/dashboard/stats', { auth: session });
  expect(res.status).toBe(200);
  return res.body.metrics;
}

/** Every API metric (except those the shell renders as its own leading card) is shown with the same value. */
async function expectCardsMatchApi(page: Page, metrics: Metric[], skipKeys: string[] = []) {
  const region = page.getByRole('region', { name: 'Key metrics' });
  await expect(region).toBeVisible();
  await expect(page.getByTestId('stat-card-skeleton')).toHaveCount(0);
  for (const metric of metrics.filter((m) => !skipKeys.includes(m.key))) {
    const label = region.getByText(metric.label, { exact: true });
    await expect(label, `card "${metric.label}"`).toBeVisible();
    const value = label.locator('xpath=preceding-sibling::p[1]/span[1]');
    await expect(value, `value of "${metric.label}"`).toHaveText(fmt(metric.value));
  }
}

const quickLink = (page: Page, name: RegExp) => page.getByRole('navigation', { name: 'Quick links' }).getByRole('link', { name });

test.describe('Role dashboards: metric cards and quick links', () => {
  test('Super Admin: platform metrics and quick links to Users / Impersonation History', async ({ page, api, seed, narrate, loginAs }) => {
    const admin = await api.superAdmin();
    await narrate('Super Admin signs in: the dashboard shows platform-wide metric cards');
    await loginAs(seed.superAdmin.email, seed.superAdmin.password);
    await expect(page.getByRole('heading', { name: 'Welcome, Super' })).toBeVisible();
    await expect(page.getByText('Super Admin dashboard — platform overview and quick links.')).toBeVisible();

    const metrics = await fetchMetrics(api, admin);
    for (const label of ['Total users', 'Active trainers', 'Coaches', 'Players & parents', 'Inactive & deleted accounts', 'New users', 'Impersonation sessions']) {
      expect(metrics.map((m) => m.label)).toContain(label);
    }
    await expectCardsMatchApi(page, metrics);
    await highlight(page.getByRole('region', { name: 'Key metrics' }));
    await expect(page.getByRole('region', { name: 'Key metrics' }).getByText('Total users', { exact: true })).toBeVisible();

    await narrate('Quick link: Users');
    await quickLink(page, /^Users/).click();
    await expect(page).toHaveURL(/\/users$/);
    await expect(page.getByRole('heading', { name: 'Users', level: 1 })).toBeVisible();

    await narrate('Back on the dashboard, quick link: Impersonation History');
    await shell(page).goTo('Dashboard');
    await expect(page.getByRole('heading', { name: 'Welcome, Super' })).toBeVisible();
    await quickLink(page, /^Impersonation History/).click();
    await expect(page).toHaveURL(/\/impersonation-history$/);
    await expect(page.getByRole('heading', { name: 'Impersonation History', level: 1 })).toBeVisible();
  });

  test('Trainer: roster / invite / share-link metrics and quick links', async ({ page, api, mailbox, narrate, loginAs }) => {
    const trainer = await createTrainer(api, mailbox);
    await createCoach(api, mailbox, trainer);
    await createPlayer(api, trainer);
    const invite = await api.post('/coaches/invite', { auth: trainer.session, body: { email: uniqueEmail('pending') } });
    expect(invite.status).toBe(201);

    await narrate('Trainer signs in: welcome, business card and metric cards');
    await loginAs(trainer.email, trainer.password);
    await expect(page.getByRole('heading', { name: `Welcome, ${trainer.firstName}` })).toBeVisible();
    await expect(page.getByText(trainer.businessName).first()).toBeVisible();

    const metrics = await fetchMetrics(api, trainer.session);
    const byKey = Object.fromEntries(metrics.map((m) => [m.key, m.value]));
    expect(byKey.active_coaches).toBe(1);
    expect(byKey.connected_players).toBe(1);
    expect(byKey.pending_coach_invites).toBe(1);
    expect(byKey.active_share_links).toBeGreaterThanOrEqual(1);

    await expectCardsMatchApi(page, metrics, ['active_coaches', 'connected_players']);
    const region = page.getByRole('region', { name: 'Key metrics' });
    await narrate('Bootstrap-backed cards: Coaches = 1 and Active Players = 1 (both are links)');
    await expect(region.getByRole('link', { name: /1\s*Coaches/ })).toBeVisible();
    await expect(region.getByRole('link', { name: /1\s*Active Players/ })).toBeVisible();
    await highlight(region);

    await narrate('The "Pending coach invites" card counts the outstanding invitation');
    await expect(region.getByText('Pending coach invites', { exact: true }).locator('xpath=preceding-sibling::p[1]/span[1]')).toHaveText('1');

    await narrate('The Coaches stat card links to /coaches');
    await region.getByRole('link', { name: /Coaches/ }).click();
    await expect(page).toHaveURL(/\/coaches$/);
    await shell(page).goTo('Dashboard');
    await narrate('The Active Players card links to /players');
    await region.getByRole('link', { name: /Active Players/ }).click();
    await expect(page).toHaveURL(/\/players$/);

    for (const [link, url, heading] of [
      [/^Manage Coaches/, /\/coaches$/, 'Coaches'],
      [/^Players/, /\/players$/, 'Players'],
      [/^Manage Share Links/, /\/share-links$/, 'Share Links'],
      [/^Branding/, /\/branding$/, 'Branding'],
    ] as const) {
      await shell(page).goTo('Dashboard');
      await expect(page.getByRole('heading', { name: `Welcome, ${trainer.firstName}` })).toBeVisible();
      await narrate(`Quick link -> ${heading}`);
      await quickLink(page, link).click();
      await expect(page).toHaveURL(url);
      await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible();
    }
  });

  test('Coach: availability metrics follow My Times, employing-trainer card and quick links', async ({ page, api, mailbox, narrate, loginAs }) => {
    const trainer = await createTrainer(api, mailbox);
    const coach = await createCoach(api, mailbox, trainer);
    const put = await api.put(`/coaches/${coach.coachId}/availability`, {
      auth: coach.session,
      body: {
        slots: [
          { dayOfWeek: 1, startTime: 16 * 60, endTime: 18 * 60, isAvailable: true },
          { dayOfWeek: 1, startTime: 19 * 60, endTime: 21 * 60, isAvailable: true },
        ],
      },
    });
    expect(put.status).toBeLessThan(300);

    await narrate('Coach signs in: employing trainer card, no "set availability" nudge (slots exist)');
    await loginAs(coach.email, coach.password);
    await expect(page.getByRole('heading', { name: `Welcome, ${coach.firstName}` })).toBeVisible();
    await expect(page.getByText('Employing trainer')).toBeVisible();
    await expect(page.getByText(trainer.businessName).first()).toBeVisible();
    await expect(page.getByText("You haven't set your availability yet.")).toHaveCount(0);

    const metrics = await fetchMetrics(api, coach.session);
    const byKey = Object.fromEntries(metrics.map((m) => [m.key, m.value]));
    expect(byKey.weekly_slots).toBe(2);
    expect(byKey.weekly_hours).toBe(4);
    expect(byKey.team_coaches).toBe(1);
    await expectCardsMatchApi(page, metrics);
    await highlight(page.getByRole('region', { name: 'Key metrics' }));
    await expect(page.getByText('Weekly availability slots', { exact: true }).locator('xpath=preceding-sibling::p[1]/span[1]')).toHaveText('2');
    await expect(page.getByText('Available hours per week', { exact: true }).locator('xpath=preceding-sibling::p[1]')).toContainText('4');

    await narrate('Quick link: My Times');
    await quickLink(page, /^My Times/).click();
    await expect(page).toHaveURL(/\/my-times$/);
    await expect(page.getByRole('heading', { name: 'My Times', level: 1 })).toBeVisible();

    await narrate('Quick link: Profile');
    await shell(page).goTo('Dashboard');
    await quickLink(page, /^Profile/).click();
    await expect(page).toHaveURL(/\/profile$/);
    await expect(page.getByRole('heading', { name: 'Profile', level: 1 })).toBeVisible();
  });

  test('Player / parent: profile and trainer metrics, Pending Approvals card and quick links', async ({ page, api, mailbox, narrate, loginAs }) => {
    const trainer = await createTrainer(api, mailbox);
    const player = await createPlayer(api, trainer);

    await narrate('Player signs in to the player dashboard');
    await loginAs(player.email, player.password);
    await expect(page.getByRole('heading', { name: `Welcome, ${player.firstName}` })).toBeVisible();

    const metrics = await fetchMetrics(api, player.session);
    const byKey = Object.fromEntries(metrics.map((m) => [m.key, m.value]));
    expect(byKey.profiles).toBe(1);
    expect(byKey.connected_trainers).toBe(1);
    await expectCardsMatchApi(page, metrics, ['pending_approvals']);
    const region = page.getByRole('region', { name: 'Key metrics' });
    await highlight(region);

    await narrate('"Pending Approvals" is a card that links to /approvals');
    const approvals = region.getByRole('link', { name: /Pending Approvals/ });
    await expect(approvals).toBeVisible();
    await approvals.click();
    await expect(page).toHaveURL(/\/approvals$/);

    await narrate('Quick links: Manage Profiles');
    await shell(page).goTo('Dashboard');
    await quickLink(page, /^Manage Profiles/).click();
    await expect(page).toHaveURL(/\/profiles$/);
    await shell(page).goTo('Dashboard');
    await narrate('Quick links: Approvals');
    await quickLink(page, /^Approvals/).click();
    await expect(page).toHaveURL(/\/approvals$/);
  });
});
