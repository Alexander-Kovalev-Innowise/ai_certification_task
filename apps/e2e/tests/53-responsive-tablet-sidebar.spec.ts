import type { Page } from '@playwright/test';

import { test, expect, shell, createTrainer } from '../support/test';

/**
 * Spec "Mobile Requirements" - tablet (768x1024, `tablet` project): the sidebar is shown (md breakpoint) and its collapse handle
 * folds it into an icon rail and back, without ever making the page scroll sideways.
 */
async function expectNoPageOverflow(page: Page, label: string) {
  const metrics = await page.evaluate(() => ({ scrollWidth: document.scrollingElement?.scrollWidth ?? 0, innerWidth: window.innerWidth }));
  expect(metrics.scrollWidth, `${label}: page must not scroll sideways`).toBeLessThanOrEqual(metrics.innerWidth);
}

test('tablet: the sidebar is shown and its collapse handle folds it to an icon rail and back', async ({ page, api, mailbox, narrate, loginAs }) => {
  const trainer = await createTrainer(api, mailbox);
  const app = shell(page);
  await loginAs(trainer.email, trainer.password);
  await expect(page.getByRole('heading', { name: /^Welcome,/ })).toBeVisible();

  await narrate('Sidebar with labels at 768px');
  await expect(app.collapseToggle).toBeVisible();
  expect(await app.isCollapsed()).toBe(false);
  const open = (await app.sidebar.boundingBox())!;
  expect(open.width).toBeGreaterThan(200);
  await expectNoPageOverflow(page, 'expanded sidebar');

  await narrate('Collapse to the icon rail: the content gets the space, nothing overflows');
  await app.collapseToggle.click();
  await expect.poll(() => app.isCollapsed()).toBe(true);
  await expect.poll(async () => (await app.sidebar.boundingBox())!.width).toBeLessThan(120);
  await expectNoPageOverflow(page, 'collapsed sidebar');
  await app.navLink('Coaches').click();
  await expect(page.getByRole('heading', { name: 'Coaches', level: 1 })).toBeVisible();

  await narrate('Expand again');
  await app.collapseToggle.click();
  await expect.poll(() => app.isCollapsed()).toBe(false);
  await expectNoPageOverflow(page, 'expanded sidebar');
});
