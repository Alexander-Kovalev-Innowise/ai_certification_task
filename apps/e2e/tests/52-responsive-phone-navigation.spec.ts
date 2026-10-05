import type { Page } from '@playwright/test';

import { test, expect, shell, createTrainer } from '../support/test';

/**
 * Spec "Mobile Requirements" - phone (375x812, `phone` project): below the md breakpoint the sidebar becomes a horizontally
 * scrolling nav strip above the content and the collapse handle is not needed. Every link must stay reachable and tappable.
 */
const MIN_TOUCH_TARGET = 40;

async function expectNoPageOverflow(page: Page, label: string) {
  const metrics = await page.evaluate(() => ({ scrollWidth: document.scrollingElement?.scrollWidth ?? 0, innerWidth: window.innerWidth }));
  expect(metrics.scrollWidth, `${label}: page must not scroll sideways`).toBeLessThanOrEqual(metrics.innerWidth);
}

test('phone: the navigation is a scrolling strip - every link is reachable and works; there is no sidebar collapse handle', async ({
  page,
  api,
  mailbox,
  narrate,
  loginAs,
}) => {
  const trainer = await createTrainer(api, mailbox);
  const app = shell(page);
  await loginAs(trainer.email, trainer.password);
  await expect(page.getByRole('heading', { name: /^Welcome,/ })).toBeVisible();
  const width = page.viewportSize()!.width;

  await narrate('The collapse handle is hidden on a phone; the nav is one horizontal strip');
  await expect(app.collapseToggle).toBeHidden();
  const strip = await app.nav.evaluate((nav) => ({
    overflowX: getComputedStyle(nav).overflowX,
    canScroll: nav.scrollWidth > nav.clientWidth,
    width: nav.getBoundingClientRect().width,
  }));
  expect(strip.overflowX).toBe('auto');
  expect(strip.canScroll).toBe(true);
  expect(strip.width).toBeLessThanOrEqual(width);

  await narrate('Scroll through the strip: every link can be brought into view and is a big enough tap target');
  const links = app.nav.getByRole('link');
  const count = await links.count();
  expect(count).toBeGreaterThanOrEqual(5);
  for (let index = 0; index < count; index += 1) {
    const link = links.nth(index);
    await link.scrollIntoViewIfNeeded();
    const box = (await link.boundingBox())!;
    expect(box.height, 'nav link tap height').toBeGreaterThanOrEqual(MIN_TOUCH_TARGET);
  }

  await narrate('Open the last link (Account) from the end of the strip');
  await links.nth(count - 1).click();
  await expect(page).toHaveURL(/\/account\/profile/);
  await expectNoPageOverflow(page, 'after navigating through the strip');

  await narrate('The account menu (sign out) opens inside the screen');
  await app.openUserMenu();
  const menu = (await page.getByRole('menu').boundingBox())!;
  expect(menu.x).toBeGreaterThanOrEqual(0);
  expect(menu.x + menu.width).toBeLessThanOrEqual(width + 1);
});
