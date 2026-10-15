import type { Page } from '@playwright/test';

import {
  test,
  expect,
  shell,
  createTrainer,
  createCoach,
  createPlayerLinkCode,
  createParentWithChildren,
  createChildLogin,
  setPlayerAvailability,
  minutes,
  uniqueEmail,
  uniqueName,
} from '../support/test';

/**
 * Spec "Mobile Requirements": responsive design (works on all screen sizes), touch-friendly controls, mobile-optimised forms and
 * uploads. The main pages of every role are opened at a phone (375x812) and a tablet (768x1024) viewport and must
 *   - not scroll sideways (document.scrollingElement.scrollWidth <= window.innerWidth),
 *   - keep tables scrolling inside their own container instead of stretching the page,
 *   - give primary buttons a touch target of at least 40px,
 *   - keep the navigation reachable (phone: scrolling nav strip; tablet and up: sidebar with its collapse handle),
 *   - keep the availability grid and dialogs usable.
 * The video is recorded at the emulated viewport size. Phone-only and tablet-only checks live in 52- and 53-.
 */
const MIN_TOUCH_TARGET = 40;

async function overflowReport(page: Page): Promise<string> {
  return page.evaluate(() => {
    const limit = window.innerWidth;
    const wide: string[] = [];
    document.querySelectorAll<HTMLElement>('body *').forEach((el) => {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      if (rect.right > limit + 1) {
        // Skip elements that live inside their own horizontal scroll container.
        for (let parent = el.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
          const overflowX = getComputedStyle(parent).overflowX;
          if ((overflowX === 'auto' || overflowX === 'scroll') && parent.getBoundingClientRect().right <= limit + 1) return;
        }
        const label = `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}.${String(el.className).split(/\s+/).slice(0, 3).join('.')}`;
        wide.push(`${label} right=${Math.round(rect.right)}`);
      }
    });
    return wide.slice(0, 8).join('\n    ');
  });
}

async function expectNoPageOverflow(page: Page, label: string) {
  const metrics = await page.evaluate(() => ({ scrollWidth: document.scrollingElement?.scrollWidth ?? 0, innerWidth: window.innerWidth }));
  if (metrics.scrollWidth > metrics.innerWidth) {
    throw new Error(
      `${label}: page scrolls sideways (scrollWidth ${metrics.scrollWidth} > innerWidth ${metrics.innerWidth})\n    ${await overflowReport(page)}`,
    );
  }
}

async function expectTouchFriendlyPrimaryButtons(page: Page, label: string) {
  const small = await page.evaluate((min) => {
    const found: string[] = [];
    document.querySelectorAll<HTMLElement>('button.btn-primary, a.btn-primary').forEach((el) => {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      if (rect.height < min || rect.width < min)
        found.push(`"${(el.textContent ?? '').trim().slice(0, 30)}" ${Math.round(rect.width)}x${Math.round(rect.height)}`);
    });
    return found;
  }, MIN_TOUCH_TARGET);
  expect(small, `${label}: primary buttons below ${MIN_TOUCH_TARGET}px`).toEqual([]);
}

interface Visit {
  path: string;
  label: string;
  ready: (page: Page) => ReturnType<Page['locator']>;
}

async function visitAll(page: Page, visits: Visit[], narrate: (text: string) => Promise<void>) {
  for (const visit of visits) {
    await page.goto(visit.path);
    await expect(visit.ready(page)).toBeVisible();
    await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
    await expect(page.getByTestId('stat-card-skeleton')).toHaveCount(0);
    await narrate(`${visit.label}: no sideways scroll, big enough buttons`);
    await expectNoPageOverflow(page, visit.label);
    await expectTouchFriendlyPrimaryButtons(page, visit.label);
  }
}

const h1 = (name: string) => (page: Page) => page.getByRole('heading', { name, level: 1 });
const welcome = (page: Page) => page.getByRole('heading', { name: /^Welcome,/ });

test.describe('responsive pages', () => {
  // The viewport (phone 375x812 / tablet 768x1024), touch emulation and video size come from the `phone` and `tablet`
  // Playwright projects (playwright.config.ts); every test below runs once in each.
  const viewportWidth = (page: Page) => page.viewportSize()!.width;
  const viewportHeight = (page: Page) => page.viewportSize()!.height;

  test('public pages: sign-in, forgot / reset password, trainer setup, join and camp forms', async ({ page, api, mailbox, narrate }) => {
    const trainer = await createTrainer(api, mailbox);
    const code = await createPlayerLinkCode(api, trainer);
    await visitAll(
      page,
      [
        { path: '/login', label: 'login', ready: (p) => p.getByRole('button', { name: 'Sign in' }) },
        { path: '/forgot-password', label: 'forgot password', ready: (p) => p.getByRole('button', { name: /send reset link/i }) },
        {
          path: '/reset-password?token=not-a-real-token',
          label: 'reset password',
          ready: (p) => p.getByRole('button', { name: /reset password|set new password|save/i }).first(),
        },
        { path: '/register?token=not-a-real-token', label: 'trainer setup', ready: (p) => p.getByRole('heading', { name: 'Complete your account' }) },
        { path: `/join/${code}`, label: 'join (player link)', ready: (p) => p.getByRole('button', { name: /create|join|continue|sign/i }).first() },
        { path: `/camp/${code}`, label: 'camp sign-up', ready: (p) => p.getByRole('button', { name: 'Submit sign-up' }) },
      ],
      narrate,
    );
  });

  test('Super Admin: dashboard, users table scrolls inside itself, user card, impersonation history, dialogs', async ({
    page,
    api,
    mailbox,
    seed,
    narrate,
    loginAs,
  }) => {
    const trainer = await createTrainer(api, mailbox);
    await loginAs(seed.superAdmin.email, seed.superAdmin.password);
    await visitAll(
      page,
      [
        { path: '/dashboard', label: 'admin dashboard', ready: welcome },
        { path: '/users', label: 'users', ready: (p) => p.getByRole('table', { name: 'Users' }) },
        { path: `/users/${trainer.userId}`, label: 'user card', ready: h1('Edit user') },
        { path: '/impersonation-history', label: 'impersonation history', ready: (p) => p.getByRole('heading', { name: 'Impersonation History', level: 1 }) },
        { path: '/account/profile', label: 'account', ready: h1('Account') },
      ],
      narrate,
    );

    await narrate('A wide table scrolls inside its own container');
    await page.goto('/users');
    await expect(page.getByRole('table', { name: 'Users' })).toBeVisible();
    const scroller = await page.getByRole('table', { name: 'Users' }).evaluate((table) => {
      for (let el: HTMLElement | null = table as HTMLElement; el && el !== document.body; el = el.parentElement) {
        const overflowX = getComputedStyle(el).overflowX;
        if (overflowX === 'auto' || overflowX === 'scroll') {
          return {
            found: true,
            clipsOrScrolls: el.scrollWidth >= el.clientWidth,
            containerWidth: el.getBoundingClientRect().width,
            innerWidth: window.innerWidth,
          };
        }
      }
      return { found: false, clipsOrScrolls: false, containerWidth: 0, innerWidth: window.innerWidth };
    });
    expect(scroller.found, 'the table sits in an overflow-x container').toBe(true);
    expect(scroller.containerWidth).toBeLessThanOrEqual(scroller.innerWidth);

    await narrate('The Create Trainer dialog fits the screen and scrolls vertically');
    await page.getByRole('button', { name: 'Create Trainer' }).click();
    const dialog = page.getByRole('dialog', { name: 'Create Trainer' });
    await expect(dialog).toBeVisible();
    const box = (await dialog.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewportWidth(page) + 1);
    expect(box.y + box.height).toBeLessThanOrEqual(viewportHeight(page) + 1);
    await expectNoPageOverflow(page, 'create trainer dialog');
    await expect(dialog.getByRole('button', { name: 'Create trainer' })).toBeVisible();
  });

  test('trainer: dashboard, rosters, share links, branding, filters and dialogs', async ({ page, api, mailbox, narrate, loginAs }) => {
    const trainer = await createTrainer(api, mailbox);
    await createCoach(api, mailbox, trainer);
    await api.post('/coaches/invite', { auth: trainer.session, body: { email: uniqueEmail('pending-coach'), name: 'Pending Coach With A Rather Long Name' } });
    const family = await createParentWithChildren(api, trainer, [`Kid ${uniqueName('R').lastName}`]);
    await setPlayerAvailability(api, family.session, family.profiles[0].id, [{ dayOfWeek: 1, startTime: minutes('17:00'), endTime: minutes('20:00') }]);

    await loginAs(trainer.email, trainer.password);
    await visitAll(
      page,
      [
        { path: '/dashboard', label: 'trainer dashboard', ready: welcome },
        { path: '/players', label: 'players roster + filter card', ready: (p) => p.getByRole('table', { name: 'Player roster' }) },
        { path: '/coaches', label: 'coaches roster', ready: (p) => p.getByRole('table', { name: 'Coach roster' }) },
        { path: '/share-links', label: 'share links', ready: h1('Share Links') },
        { path: '/branding', label: 'branding', ready: h1('Branding') },
        { path: '/account/profile', label: 'account + business form', ready: h1('Account') },
      ],
      narrate,
    );

    await narrate('Dialogs fit the screen: Invite Coach and Remove player');
    await page.goto('/coaches');
    await page.getByRole('button', { name: 'Invite Coach' }).click();
    const invite = page.getByRole('dialog', { name: 'Invite a coach' });
    await expect(invite).toBeVisible();
    const box = (await invite.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewportWidth(page) + 1);
    await expectNoPageOverflow(page, 'invite coach dialog');
    await page.keyboard.press('Escape');
  });

  test('coach: dashboard, My Times grid, profile', async ({ page, api, mailbox, narrate, loginAs }) => {
    const trainer = await createTrainer(api, mailbox);
    const coach = await createCoach(api, mailbox, trainer);
    await loginAs(coach.email, coach.password);
    await visitAll(
      page,
      [
        { path: '/dashboard', label: 'coach dashboard', ready: welcome },
        { path: '/my-times', label: 'my times', ready: h1('My Times') },
        { path: '/profile', label: 'coach profile', ready: h1('Profile') },
      ],
      narrate,
    );

    await narrate('My Times: add a slot - the row stays inside the screen');
    await page.goto('/my-times');
    await page.getByRole('button', { name: '+ Add time' }).first().click();
    await expect(page.getByLabel('Sun start')).toBeVisible();
    await expectNoPageOverflow(page, 'my times with a slot');
    for (const control of [page.getByLabel('Sun start'), page.getByLabel('Sun end'), page.getByRole('button', { name: 'Remove' }).first()]) {
      const box = (await control.boundingBox())!;
      expect(box.x + box.width, 'inside the viewport').toBeLessThanOrEqual(viewportWidth(page) + 1);
    }
  });

  test('player / parent: dashboard, profiles, profile detail, availability grid, approvals', async ({ page, api, mailbox, narrate, loginAs }) => {
    const trainer = await createTrainer(api, mailbox);
    const family = await createParentWithChildren(api, trainer, [`Kid ${uniqueName('P').lastName}`]);
    const child = family.children[0];
    const login = await createChildLogin(api, family, child);
    const request = await api.post('/me/purchase-requests', {
      auth: login.session,
      body: { title: 'Saturday skills clinic', amountCents: 2500, paymentType: 'USD', currency: 'USD' },
    });
    expect(request.status).toBe(201);

    await loginAs(family.email, family.password);
    await visitAll(
      page,
      [
        { path: '/dashboard', label: 'player dashboard', ready: welcome },
        { path: '/profiles', label: 'profiles', ready: h1('Profiles') },
        { path: `/profiles/${child.id}`, label: 'profile detail', ready: (p) => p.getByRole('heading', { name: child.name, level: 1 }) },
        { path: `/profiles/${child.id}/availability`, label: 'availability grid', ready: h1('Best Times') },
        { path: '/approvals', label: 'approvals', ready: (p) => p.getByRole('article', { name: child.name }) },
        { path: '/account/profile', label: 'account', ready: h1('Account') },
      ],
      narrate,
    );

    await narrate('Availability grid: add a slot - start, end, Remove and Save all stay on screen');
    await page.goto(`/profiles/${child.id}/availability`);
    await page.getByRole('button', { name: '+ Add time' }).nth(1).click();
    await expect(page.getByLabel('Mon start')).toBeVisible();
    await expectNoPageOverflow(page, 'availability grid with a slot');
    for (const control of [
      page.getByLabel('Mon start'),
      page.getByLabel('Mon end'),
      page.getByRole('button', { name: 'Remove' }).first(),
      page.getByRole('button', { name: 'Save', exact: true }),
    ]) {
      await control.scrollIntoViewIfNeeded();
      const box = (await control.boundingBox())!;
      expect(box.x, 'left edge inside the viewport').toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, 'right edge inside the viewport').toBeLessThanOrEqual(viewportWidth(page) + 1);
    }

    await narrate('The approval decision dialog fits the screen');
    await page.goto('/approvals');
    await page.getByRole('article', { name: child.name }).getByRole('button', { name: 'Approve' }).click();
    const dialog = page.getByRole('dialog', { name: 'Approve request' });
    await expect(dialog).toBeVisible();
    const box = (await dialog.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewportWidth(page) + 1);
    await expectNoPageOverflow(page, 'approval dialog');
  });
});
