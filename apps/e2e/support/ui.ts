import { expect, type Locator, type Page } from '@playwright/test';

export interface LoginOptions {
  /** URL (string/regex) expected after a successful login. Default: /dashboard. */
  expectUrl?: string | RegExp;
}

/** Fills the REAL login form (/login) and submits it. Resolves once the post-login URL is reached. */
export async function loginAs(page: Page, email: string, password: string, opts: LoginOptions = {}): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(opts.expectUrl ?? /\/dashboard/, { timeout: 20_000 });
}

/** Locators + actions for the authenticated app shell (apps/client AppShell). */
export function shell(page: Page) {
  const sidebar = page.locator('aside[data-collapsed]');
  const html = page.locator('html');
  return {
    sidebar,
    /** Main role navigation (aria-label differs per role, so match any `nav` inside the sidebar). */
    nav: sidebar.getByRole('navigation'),
    navLink: (label: string): Locator => sidebar.getByRole('link', { name: label, exact: true }),
    /** Click a sidebar item (client-side navigation, no full reload). */
    async goTo(label: string) {
      await sidebar.getByRole('link', { name: label, exact: true }).click();
    },
    collapseToggle: page.getByRole('button', { name: /^(Collapse|Expand) sidebar$/ }),
    /** `data-collapsed` of the sidebar: true | false. */
    async isCollapsed(): Promise<boolean> {
      return (await sidebar.getAttribute('data-collapsed')) === 'true';
    },
    userMenuButton: page.getByRole('button', { name: 'Account menu' }),
    async openUserMenu() {
      const button = page.getByRole('button', { name: 'Account menu' });
      if ((await button.getAttribute('aria-expanded')) !== 'true') await button.click();
      await expect(page.getByRole('menu')).toBeVisible();
    },
    async signOut() {
      await this.openUserMenu();
      await page.getByRole('menuitem', { name: 'Sign out' }).click();
    },
    /** Works in the shell AND on the auth card pages (both render <ThemeToggle>). */
    themeToggle: page.getByRole('button', { name: /^Switch to (dark|light) theme$/ }),
    async theme(): Promise<string> {
      return (await html.getAttribute('data-theme')) ?? 'dark';
    },
    async toggleTheme() {
      await page.getByRole('button', { name: /^Switch to (dark|light) theme$/ }).click();
    },
    /**
     * Tags the sidebar DOM node with a JS expando. After a client-side navigation call
     * `sidebarIsSameElement()`: true means it was NOT unmounted/re-created.
     */
    async markSidebar() {
      await sidebar.evaluate((el) => {
        (el as unknown as Record<string, unknown>).__e2eMark = 'same-node';
      });
    },
    async sidebarIsSameElement(): Promise<boolean> {
      return sidebar.evaluate((el) => (el as unknown as Record<string, unknown>).__e2eMark === 'same-node');
    },
  };
}
