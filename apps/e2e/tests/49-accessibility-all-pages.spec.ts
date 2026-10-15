import type { Page } from '@playwright/test';

import { dropDevToolsPortal, expectNoSeriousA11yViolations, tabUntilFocused, useTheme, type Theme } from '../support/a11y';
import {
  test,
  expect,
  createTrainer,
  createCoach,
  createPlayerLinkCode,
  createParentWithChildren,
  createChildLogin,
  registerParent,
  setPlayerAvailability,
  minutes,
  uniqueEmail,
  uniqueName,
  type ApiClient,
  type TrainerFixture,
} from '../support/test';

/**
 * Spec "Accessibility Requirements": WCAG 2.1 AA, keyboard navigation for all forms, screen reader support, colour contrast,
 * clear focus indicators. Spec 40 scans login / forgot-password / Super Admin dashboard + users; this file extends the same
 * axe approach (wcag2a + wcag2aa + wcag21aa, zero serious/critical violations, BOTH themes) to every other page:
 *   trainer: dashboard, players, coaches, share-links, branding (+ the open Invite Coach / Generate Link dialogs)
 *   coach: dashboard, my-times, profile
 *   player / parent: dashboard, profiles, profile detail, availability, approvals, account
 *   Super Admin: user card, impersonation history, account
 *   public: join, register, reset-password, verify-email, camp
 * plus a keyboard-only walk-through of the approvals decision dialog and of the availability grid.
 */
const THEMES: Theme[] = ['dark', 'light'];

interface PageToScan {
  path: string;
  label: string;
  /** Wait for this before scanning; default = the page's level-1 heading. */
  ready?: (page: Page) => ReturnType<Page['locator']>;
}

async function scanPages(page: Page, theme: Theme, pages: PageToScan[], narrate: (text: string) => Promise<void>) {
  for (const target of pages) {
    await page.goto(target.path);
    const ready = target.ready ? target.ready(page) : page.getByRole('heading', { level: 1 }).first();
    await expect(ready).toBeVisible();
    await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
    await expect(page.getByTestId('stat-card-skeleton')).toHaveCount(0);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await narrate(`axe scan: ${target.label} (${theme})`);
    await expectNoSeriousA11yViolations(page, `${target.label} / ${theme}`);
  }
}

async function trainerWithData(api: ApiClient, mailbox: Parameters<typeof createTrainer>[1]) {
  const trainer = await createTrainer(api, mailbox);
  await createCoach(api, mailbox, trainer);
  await api.post('/coaches/invite', { auth: trainer.session, body: { email: uniqueEmail('pending-coach'), name: 'Pending Coach' } });
  const family = await createParentWithChildren(api, trainer, [`Kid ${uniqueName('A').lastName}`]);
  await setPlayerAvailability(api, family.session, family.profiles[0].id, [{ dayOfWeek: 1, startTime: minutes('17:00'), endTime: minutes('20:00') }]);
  return { trainer, family };
}

for (const theme of THEMES) {
  test.describe(`axe, every page: ${theme} theme`, () => {
    test.beforeEach(async ({ page }) => {
      await useTheme(page, theme);
    });

    test('trainer pages and dialogs', async ({ page, api, mailbox, narrate, loginAs }) => {
      const { trainer } = await trainerWithData(api, mailbox);
      await loginAs(trainer.email, trainer.password);
      await scanPages(
        page,
        theme,
        [
          { path: '/dashboard', label: 'trainer dashboard', ready: (p) => p.getByRole('heading', { name: /^Welcome,/ }) },
          { path: '/players', label: 'players roster', ready: (p) => p.getByRole('table', { name: 'Player roster' }) },
          { path: '/coaches', label: 'coaches roster', ready: (p) => p.getByRole('table', { name: 'Coach roster' }) },
          { path: '/share-links', label: 'share links', ready: (p) => p.getByRole('heading', { name: 'Share Links', level: 1 }) },
          { path: '/branding', label: 'branding', ready: (p) => p.getByRole('heading', { name: 'Branding', level: 1 }) },
          { path: '/account/profile', label: 'trainer account', ready: (p) => p.getByRole('heading', { name: 'Account', level: 1 }) },
        ],
        narrate,
      );

      await page.goto('/coaches');
      await page.getByRole('button', { name: 'Invite Coach' }).click();
      await expect(page.getByRole('dialog', { name: 'Invite a coach' })).toBeVisible();
      await narrate(`axe scan: Invite Coach dialog (${theme})`);
      await expectNoSeriousA11yViolations(page, `invite-coach dialog / ${theme}`);
      await page.keyboard.press('Escape');

      await page.goto('/share-links');
      await page.getByRole('button', { name: 'Generate Link' }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await narrate(`axe scan: Generate Link dialog (${theme})`);
      await expectNoSeriousA11yViolations(page, `generate-link dialog / ${theme}`);
      await page.keyboard.press('Escape');

      await page.goto('/players');
      await expect(page.getByRole('table', { name: 'Player roster' })).toBeVisible();
      await page
        .getByRole('button', { name: /^Remove / })
        .first()
        .click();
      await expect(page.getByRole('dialog', { name: 'Remove player' })).toBeVisible();
      await narrate(`axe scan: Remove player dialog (${theme})`);
      await expectNoSeriousA11yViolations(page, `remove-player dialog / ${theme}`);
    });

    test('coach pages', async ({ page, api, mailbox, narrate, loginAs }) => {
      const trainer = await createTrainer(api, mailbox);
      const coach = await createCoach(api, mailbox, trainer);
      await loginAs(coach.email, coach.password);
      await scanPages(
        page,
        theme,
        [
          { path: '/dashboard', label: 'coach dashboard', ready: (p) => p.getByRole('heading', { name: /^Welcome,/ }) },
          { path: '/my-times', label: 'coach my-times', ready: (p) => p.getByRole('heading', { name: 'My Times', level: 1 }) },
          { path: '/profile', label: 'coach profile', ready: (p) => p.getByRole('heading', { name: 'Profile', level: 1 }) },
          { path: '/account/profile', label: 'coach account', ready: (p) => p.getByRole('heading', { name: 'Account', level: 1 }) },
        ],
        narrate,
      );
    });

    test('player / parent pages, including a pending approval', async ({ page, api, mailbox, narrate, loginAs }) => {
      const trainer = await createTrainer(api, mailbox);
      const family = await createParentWithChildren(api, trainer, [`Kid ${uniqueName('B').lastName}`]);
      const child = family.children[0];
      await setPlayerAvailability(api, family.session, child.id, [{ dayOfWeek: 3, startTime: minutes('18:00'), endTime: minutes('21:00') }]);
      const login = await createChildLogin(api, family, child);
      const request = await api.post('/me/purchase-requests', {
        auth: login.session,
        body: { title: 'Saturday skills clinic', amountCents: 2500, paymentType: 'USD', currency: 'USD' },
      });
      expect(request.status).toBe(201);

      await loginAs(family.email, family.password);
      await scanPages(
        page,
        theme,
        [
          { path: '/dashboard', label: 'player dashboard', ready: (p) => p.getByRole('heading', { name: /^Welcome,/ }) },
          { path: '/profiles', label: 'profiles', ready: (p) => p.getByRole('heading', { name: 'Profiles', level: 1 }) },
          { path: `/profiles/${child.id}`, label: 'profile detail', ready: (p) => p.getByRole('heading', { name: child.name, level: 1 }) },
          { path: `/profiles/${child.id}/availability`, label: 'availability (edit)', ready: (p) => p.getByRole('heading', { name: 'Best Times', level: 1 }) },
          { path: '/approvals', label: 'approvals', ready: (p) => p.getByRole('article', { name: child.name }) },
          { path: '/account/profile', label: 'player account', ready: (p) => p.getByRole('heading', { name: 'Account', level: 1 }) },
        ],
        narrate,
      );

      await page.goto('/approvals');
      await page.getByRole('article', { name: child.name }).getByRole('button', { name: 'Approve' }).click();
      await expect(page.getByRole('dialog', { name: 'Approve request' })).toBeVisible();
      await narrate(`axe scan: approval decision dialog (${theme})`);
      await expectNoSeriousA11yViolations(page, `approval dialog / ${theme}`);
      await page.keyboard.press('Escape');

      await page.goto(`/profiles/${child.id}`);
      await page.getByRole('button', { name: 'Add Trainer' }).click();
      await expect(page.getByRole('dialog', { name: 'Add a trainer' })).toBeVisible();
      await narrate(`axe scan: Add Trainer dialog (${theme})`);
      await expectNoSeriousA11yViolations(page, `add-trainer dialog / ${theme}`);
    });

    test('Super Admin user card, impersonation history and account', async ({ page, api, mailbox, seed, narrate, loginAs }) => {
      const trainer = await createTrainer(api, mailbox);
      await loginAs(seed.superAdmin.email, seed.superAdmin.password);
      await scanPages(
        page,
        theme,
        [
          { path: `/users/${trainer.userId}`, label: 'user card', ready: (p) => p.getByRole('heading', { name: 'Edit user', level: 1 }) },
          { path: '/impersonation-history', label: 'impersonation history', ready: (p) => p.getByRole('heading', { name: 'Impersonation History', level: 1 }) },
          { path: '/account/profile', label: 'super admin account', ready: (p) => p.getByRole('heading', { name: 'Account', level: 1 }) },
        ],
        narrate,
      );
    });

    test('public pages: join, register, reset-password, verify-email, camp', async ({ page, api, mailbox, narrate }) => {
      const trainer: TrainerFixture = await createTrainer(api, mailbox);
      const code = await createPlayerLinkCode(api, trainer);
      await scanPages(
        page,
        theme,
        [
          { path: `/join/${code}`, label: 'join (player link)', ready: (p) => p.getByRole('button', { name: /create|join|continue|sign/i }).first() },
          {
            path: '/register?token=not-a-real-token',
            label: 'register (trainer setup)',
            ready: (p) => p.getByRole('heading', { name: 'Complete your account' }),
          },
          {
            path: '/reset-password?token=not-a-real-token',
            label: 'reset password',
            ready: (p) => p.getByRole('button', { name: /reset password|set new password|save/i }).first(),
          },
          { path: '/verify-email?token=not-a-real-token', label: 'verify email', ready: (p) => p.getByRole('alert').or(p.getByRole('status')).first() },
          { path: `/camp/${code}`, label: 'camp sign-up', ready: (p) => p.getByRole('button', { name: 'Submit sign-up' }) },
        ],
        narrate,
      );
    });
  });
}

test.describe('keyboard-only walk-throughs', () => {
  test('approvals: Tab to a request, Enter opens the decision dialog, focus is trapped, Escape closes and returns focus, Enter confirms', async ({
    page,
    api,
    mailbox,
    narrate,
    loginAs,
  }) => {
    const trainer = await createTrainer(api, mailbox);
    const family = await createParentWithChildren(api, trainer, [`Kid ${uniqueName('C').lastName}`]);
    const child = family.children[0];
    const login = await createChildLogin(api, family, child);
    for (const title of ['Skills clinic', 'Camp deposit']) {
      const request = await api.post('/me/purchase-requests', {
        auth: login.session,
        body: { title, amountCents: 2500, paymentType: 'USD', currency: 'USD' },
      });
      expect(request.status).toBe(201);
    }

    await loginAs(family.email, family.password);
    await page.goto('/approvals');
    const card = page.getByRole('article').filter({ hasText: 'Skills clinic' });
    await expect(card).toBeVisible();
    await dropDevToolsPortal(page);

    await narrate('Keyboard only: Tab until the "Approve" button of the first request is focused');
    const approve = card.getByRole('button', { name: 'Approve' });
    const presses = await tabUntilFocused(page, approve);
    expect(presses).toBeGreaterThan(1);
    const outline = await approve.evaluate((el) => {
      const style = getComputedStyle(el);
      return { style: style.outlineStyle, width: parseFloat(style.outlineWidth), shadow: style.boxShadow };
    });
    expect(outline.style !== 'none' || outline.shadow !== 'none', 'a visible focus indicator').toBe(true);

    await narrate('Enter opens the dialog and focus moves inside it');
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Approve request' });
    await expect(dialog).toBeVisible();
    const insideDialog = () => page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'));
    expect(await insideDialog()).toBe(true);
    await expect(dialog.getByLabel('Notes (optional)')).toBeFocused();

    await narrate('Tab / Shift+Tab cycle inside the dialog and never reach the page behind it');
    for (let step = 0; step < 8; step += 1) {
      await page.keyboard.press('Tab');
      expect(await insideDialog(), `Tab #${step + 1} stayed in the dialog`).toBe(true);
    }
    for (let step = 0; step < 8; step += 1) {
      await page.keyboard.press('Shift+Tab');
      expect(await insideDialog(), `Shift+Tab #${step + 1} stayed in the dialog`).toBe(true);
    }

    await narrate('Escape closes the dialog and focus returns to the "Approve" button that opened it');
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(approve).toBeFocused();

    await narrate('Open again with the keyboard, type a note, Tab to "Confirm approval" and press Enter');
    await page.keyboard.press('Enter');
    await expect(dialog).toBeVisible();
    await page.keyboard.type('Approved from the keyboard');
    await tabUntilFocused(page, dialog.getByRole('button', { name: 'Confirm approval' }), 6);
    await page.keyboard.press('Enter');
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('article').filter({ hasText: 'Skills clinic' })).toHaveCount(0);
    await expect(page.getByRole('article').filter({ hasText: 'Camp deposit' })).toBeVisible();

    const approvals = await api.get<{ items: unknown[] }>('/approvals', { auth: family.session, query: { status: 'APPROVED' } });
    expect(approvals.body.items).toHaveLength(1);
    expect(JSON.stringify(approvals.body)).toContain('Approved from the keyboard');
  });

  // The native <input type="time"> shows a 24-hour clock in en-GB, an AM/PM one in en-US: pin the locale so the typed digits mean the same everywhere.
  test.describe('availability grid', () => {
    test.use({ locale: 'en-GB' });

    test('availability grid: every control is reachable and operable with the keyboard (add a slot, set times, remove, save)', async ({
      page,
      api,
      mailbox,
      narrate,
      loginAs,
    }) => {
      const trainer = await createTrainer(api, mailbox);
      const parent = await registerParent(api, await createPlayerLinkCode(api, trainer), { isSelf: true });
      const own = parent.profiles.find((profile) => profile.isSelf)!;

      await loginAs(parent.email, parent.password);
      await page.goto(`/profiles/${own.id}/availability`);
      await expect(page.getByRole('heading', { name: 'Best Times', level: 1 })).toBeVisible();
      await dropDevToolsPortal(page);

      await narrate('Tab to the Monday "+ Add time" button (it is the 2nd of seven) and press Enter');
      const addMonday = page.getByRole('button', { name: '+ Add time' }).nth(1);
      await tabUntilFocused(page, addMonday);
      await page.keyboard.press('Enter');
      const start = page.getByLabel('Mon start');
      const end = page.getByLabel('Mon end');
      await expect(start).toBeVisible();

      await narrate('Tab into the new row and type the start and end time with the keyboard');
      await tabUntilFocused(page, start, 4);
      await page.keyboard.type('1700');
      await tabUntilFocused(page, end, 8);
      await page.keyboard.type('2000');
      await expect(start).toHaveValue('17:00');
      await expect(end).toHaveValue('20:00');

      await narrate('Space on "+ Add time" adds another row; its "Remove" button is reachable and works with Enter');
      await tabUntilFocused(page, page.getByRole('button', { name: 'Remove' }).first(), 12);
      await tabUntilFocused(page, page.getByRole('button', { name: '+ Add time' }).nth(2), 12);
      await page.keyboard.press('Space');
      await expect(page.getByLabel('Tue start')).toBeVisible();
      await tabUntilFocused(page, page.getByRole('button', { name: 'Remove' }).nth(1), 12);
      await page.keyboard.press('Enter');
      await expect(page.getByLabel('Tue start')).toHaveCount(0);

      await narrate('Tab to Save and press Enter: the confirmation message appears');
      await tabUntilFocused(page, page.getByRole('button', { name: 'Save', exact: true }), 80);
      await page.keyboard.press('Enter');
      await expect(
        page.getByRole('status').filter({ hasText: 'Availability saved. Trainers can see these preferences when planning sessions.' }),
      ).toBeVisible();

      const stored = await api.get<{ slots: Array<{ dayOfWeek: number; startTime: number; endTime: number; isAvailable: boolean }> }>(
        `/player-profiles/${own.id}/availability`,
        { auth: parent.session },
      );
      expect(stored.body.slots.filter((slot) => slot.isAvailable)).toEqual([expect.objectContaining({ dayOfWeek: 1, startTime: 17 * 60, endTime: 20 * 60 })]);
    });
  });
});
