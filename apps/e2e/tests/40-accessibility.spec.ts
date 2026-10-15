import type { Page } from '@playwright/test';

import { expectNoSeriousA11yViolations, useTheme, type Theme } from '../support/a11y';
import { test, expect } from '../support/test';

/**
 * Spec section 13 - WCAG 2.1 AA.
 *  - axe (wcag2a / wcag2aa / wcag21aa) on login, forgot-password, dashboard, users and an open
 *    modal, in BOTH themes: zero serious/critical violations.
 *  - keyboard: the skip link is the first Tab stop, dialogs trap focus, Escape closes them and
 *    hands focus back to the control that opened them.
 */
const THEMES: Theme[] = ['dark', 'light'];

/**
 * `next dev` injects a focusable <nextjs-portal> (the "N" dev-tools badge) that is first in the
 * tab order. It does not exist in a production build, so drop it before testing tab order.
 */
async function dropDevToolsPortal(page: Page): Promise<void> {
  await page.evaluate(() => {
    document.querySelectorAll('nextjs-portal').forEach((node) => node.remove());
    (document.activeElement as HTMLElement | null)?.blur();
  });
}

for (const theme of THEMES) {
  test.describe(`axe: ${theme} theme`, () => {
    test.beforeEach(async ({ page }) => {
      await useTheme(page, theme);
    });

    test('login and forgot-password pages', async ({ page, narrate }) => {
      await page.goto('/login');
      await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await narrate(`axe scan: login (${theme})`);
      await expectNoSeriousA11yViolations(page, `login / ${theme}`);

      await page.goto('/forgot-password');
      await expect(page.getByRole('button', { name: /send reset link/i })).toBeVisible();
      await narrate(`axe scan: forgot password (${theme})`);
      await expectNoSeriousA11yViolations(page, `forgot-password / ${theme}`);
    });

    test('dashboard, users and the Create Trainer dialog', async ({ page, seed, loginAs, narrate }) => {
      await loginAs(seed.superAdmin.email, seed.superAdmin.password);
      await expect(page.getByRole('heading', { name: /Welcome, Super/ })).toBeVisible();
      await expect(page.getByTestId('stat-card-skeleton')).toHaveCount(0);
      await narrate(`axe scan: dashboard (${theme})`);
      await expectNoSeriousA11yViolations(page, `dashboard / ${theme}`);

      await page.goto('/users');
      await expect(page.getByRole('table', { name: 'Users' })).toBeVisible();
      await narrate(`axe scan: users table (${theme})`);
      await expectNoSeriousA11yViolations(page, `users / ${theme}`);

      await page.getByRole('button', { name: 'Create Trainer' }).click();
      const dialog = page.getByRole('dialog', { name: 'Create Trainer' });
      await expect(dialog).toBeVisible();
      await narrate(`axe scan: Create Trainer dialog (${theme})`);
      await expectNoSeriousA11yViolations(page, `create-trainer dialog / ${theme}`);
    });
  });
}

test.describe('keyboard navigation', () => {
  test('the skip link is the first Tab stop and moves focus to the main landmark', async ({ page, seed, loginAs, narrate }) => {
    await loginAs(seed.superAdmin.email, seed.superAdmin.password);
    await expect(page.getByRole('heading', { name: /Welcome, Super/ })).toBeVisible();

    await narrate('Reload and press Tab once: the first focus stop is "Skip to main content"');
    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { name: /Welcome, Super/ })).toBeVisible();
    await dropDevToolsPortal(page);
    await page.keyboard.press('Tab');
    const skipLink = page.getByRole('link', { name: 'Skip to main content' });
    await expect(skipLink).toBeFocused();
    await expect(skipLink).toBeInViewport();

    await narrate('Enter jumps past the sidebar to <main>');
    await page.keyboard.press('Enter');
    await expect(page.locator('main#main-content')).toBeFocused();

    await narrate('Exactly one main landmark, a labelled nav and a banner');
    await expect(page.getByRole('main')).toHaveCount(1);
    await expect(page.getByRole('navigation', { name: /./ }).first()).toBeVisible();
    await expect(page.getByRole('banner')).toHaveCount(1);
  });

  test('keyboard focus gets a visible outline', async ({ page, seed, loginAs }) => {
    await loginAs(seed.superAdmin.email, seed.superAdmin.password);
    await expect(page.getByRole('heading', { name: /Welcome, Super/ })).toBeVisible();
    await dropDevToolsPortal(page);
    await page.keyboard.press('Tab');
    const outline = await page.getByRole('link', { name: 'Skip to main content' }).evaluate((el) => {
      const style = getComputedStyle(el);
      return { style: style.outlineStyle, width: parseFloat(style.outlineWidth) };
    });
    expect(outline.style).not.toBe('none');
    expect(outline.width).toBeGreaterThanOrEqual(2);
  });

  test('a dialog traps focus, Escape closes it and focus returns to the opener', async ({ page, seed, loginAs, narrate }) => {
    await loginAs(seed.superAdmin.email, seed.superAdmin.password);
    await page.goto('/users');
    await expect(page.getByRole('table', { name: 'Users' })).toBeVisible();

    const opener = page.getByRole('button', { name: 'Create Trainer' });
    await opener.click();
    const dialog = page.getByRole('dialog', { name: 'Create Trainer' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel('Business name')).toBeFocused();

    const focusInsideDialog = () =>
      page.evaluate(() => {
        const active = document.activeElement;
        return !!active && !!active.closest('[role="dialog"]');
      });

    await narrate('Tab through the whole dialog and beyond: focus never leaves it');
    for (let step = 0; step < 14; step += 1) {
      await page.keyboard.press('Tab');
      expect(await focusInsideDialog(), `Tab #${step + 1} escaped the dialog`).toBe(true);
    }
    await narrate('Shift+Tab wraps backwards');
    for (let step = 0; step < 14; step += 1) {
      await page.keyboard.press('Shift+Tab');
      expect(await focusInsideDialog(), `Shift+Tab #${step + 1} escaped the dialog`).toBe(true);
    }

    await narrate('Escape closes the dialog and returns focus to "Create Trainer"');
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();
  });
});
