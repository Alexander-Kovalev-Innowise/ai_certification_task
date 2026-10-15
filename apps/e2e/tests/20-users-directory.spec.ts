import { test, expect, highlight, shell, validPhone, type ApiSession, type ApiClient } from '../support/test';
import type { Page } from '@playwright/test';

/**
 * Epic-01 section 3 "Users tool - global user directory ... tool-specific search (not global)":
 * search by name/email, role + status filters, empty state with "Clear filters", cursor pagination controls,
 * resizable columns, and no flicker while filtering (previous rows stay on screen).
 *
 * Gap (reported): the directory has no sortable column headers - the column order is fixed (newest first
 * from the API); there is nothing to test for sorting.
 */

/** Letters-only token, safe for names. */
function letters(n = 8): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz';
  return Array.from({ length: n }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
}

async function createDirectoryTrainer(api: ApiClient, admin: ApiSession, tag: string, label: string) {
  const email = `${tag}.${label}@e2e.test`;
  const res = await api.post<{ userId: string }>('/trainers', {
    auth: admin,
    body: { businessName: `${tag} ${label} Academy`, firstName: 'Dir', lastName: `${tag}${label}`, email, phone: validPhone() },
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return { email, userId: res.body.userId, fullName: `Dir ${tag}${label}` };
}

const tableRows = (page: Page) => page.getByRole('table', { name: 'Users' }).locator('[role="row"][aria-label]');

test.describe('Users directory (Super Admin)', () => {
  test.beforeEach(async ({ seed, loginAs, page, narrate }) => {
    await narrate('Super Admin signs in and opens the Users tool');
    await loginAs(seed.superAdmin.email, seed.superAdmin.password);
    await shell(page).goTo('Users');
    await expect(page.getByRole('heading', { name: 'Users', level: 1 })).toBeVisible();
  });

  test('search by name or email, role and status filters, empty state with "Clear filters"', async ({ page, api, narrate }) => {
    const admin = await api.superAdmin();
    const tag = `dirq${letters(6)}`;
    const one = await createDirectoryTrainer(api, admin, tag, 'one');
    const two = await createDirectoryTrainer(api, admin, tag, 'two');
    const deactivated = await api.post(`/users/${two.userId}/deactivate`, { auth: admin });
    expect(deactivated.status).toBe(200);
    const rows = tableRows(page);

    await narrate('Search by name: both fixtures match');
    await page.getByLabel('Search').fill(tag);
    await expect(rows).toHaveCount(2);
    await expect(page.getByRole('row', { name: one.fullName })).toBeVisible();
    await expect(page.getByRole('row', { name: two.fullName })).toBeVisible();
    await highlight(page.getByLabel('Search'));

    await narrate('Search by (part of) an email narrows it to one user');
    await page.getByLabel('Search').fill(one.email);
    await expect(rows).toHaveCount(1);
    await expect(page.getByRole('row', { name: one.fullName })).toBeVisible();
    await expect(page.getByRole('row', { name: one.fullName }).getByText(one.email)).toBeVisible();

    await narrate('Status filter: INACTIVE finds the deactivated user, ACTIVE the other one');
    await page.getByLabel('Search').fill(tag);
    await page.getByLabel('Status', { exact: true }).selectOption('INACTIVE');
    await expect(rows).toHaveCount(1);
    await expect(page.getByRole('row', { name: two.fullName }).getByText('INACTIVE', { exact: true })).toBeVisible();
    await page.getByLabel('Status', { exact: true }).selectOption('ACTIVE');
    await expect(rows).toHaveCount(1);
    await expect(page.getByRole('row', { name: one.fullName }).getByText('ACTIVE', { exact: true })).toBeVisible();
    await page.getByLabel('Status', { exact: true }).selectOption('DELETED');
    await expect(page.getByText('No users found.')).toBeVisible();
    await page.getByLabel('Status', { exact: true }).selectOption('');
    await expect(rows).toHaveCount(2);

    await narrate('Role filter: TRAINER keeps them, COACH shows the empty state');
    await page.getByLabel('Role', { exact: true }).selectOption('TRAINER');
    await expect(rows).toHaveCount(2);
    await page.getByLabel('Role', { exact: true }).selectOption('COACH');
    const empty = page.getByRole('status').filter({ hasText: 'No users found.' });
    await expect(empty).toBeVisible();
    await expect(page.getByText('No records match your filters. Try adjusting or clearing them.')).toBeVisible();
    await highlight(empty);

    await narrate('"Clear filters" resets search, role and status in one click');
    await page.getByRole('button', { name: 'Clear filters' }).click();
    await expect(page.getByLabel('Search')).toHaveValue('');
    await expect(page.getByLabel('Role', { exact: true })).toHaveValue('');
    await expect(page.getByLabel('Status', { exact: true })).toHaveValue('');
    await expect(rows.first()).toBeVisible();
    await expect(page.getByRole('row', { name: one.fullName })).toHaveCount(0); // back to the unfiltered directory
    await expect(page.getByRole('button', { name: 'Clear filters' })).toHaveCount(0);

    await narrate('Filtering by SUPER_ADMIN lists the seeded admin');
    await page.getByLabel('Role', { exact: true }).selectOption('SUPER_ADMIN');
    await expect(page.getByRole('row', { name: 'Super Admin' })).toBeVisible();
    await expect(page.getByRole('row', { name: one.fullName })).toHaveCount(0);
  });

  test('no flicker: while a filter is loading the previous rows stay on screen (dimmed, with a progress bar)', async ({ page, api, narrate }) => {
    const admin = await api.superAdmin();
    const tag = `dirf${letters(6)}`;
    const one = await createDirectoryTrainer(api, admin, tag, 'one');

    await narrate('Slow the directory API down so the loading state is visible');
    await page.route(/\/users\?/, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 2500));
      await route.continue();
    });

    const table = page.getByRole('table', { name: 'Users' });
    const firstRow = tableRows(page).first();
    await expect(firstRow).toBeVisible();
    const firstLabel = (await firstRow.getAttribute('aria-label')) ?? '';
    await narrate('Type a search: the old rows remain, the table is marked busy, a progress bar runs');
    await page.getByLabel('Search').fill(tag);
    await expect(table).toHaveAttribute('aria-busy', 'true');
    await expect(page.getByTestId('table-refresh-bar')).toBeVisible();
    await expect(page.getByRole('row', { name: firstLabel }).first()).toBeVisible(); // still there - no skeleton, no blank table
    await expect(page.getByText('No users found.')).toHaveCount(0);
    await highlight(table);

    await narrate('When the response arrives the rows swap in place');
    await expect(page.getByRole('row', { name: one.fullName })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('row', { name: firstLabel })).toHaveCount(0);
    await expect(table).toHaveAttribute('aria-busy', 'false');
    await page.unroute(/\/users\?/);
  });

  test('pagination: rows per page, numbered pages, next/previous and cursor "load more" beyond 50 users', async ({ page, api, narrate }) => {
    test.setTimeout(240_000);
    const admin = await api.superAdmin();
    const tag = `dirp${letters(6)}`;
    const labels = Array.from({ length: 55 }, (_, i) => `u${String(i + 1).padStart(2, 'a')}`.replace(/\d/g, (d) => 'abcdefghij'[Number(d)]));
    for (let i = 0; i < labels.length; i += 10) {
      await Promise.all(labels.slice(i, i + 10).map((label) => createDirectoryTrainer(api, admin, tag, label)));
    }

    await narrate('55 users match the search - the first API page holds 50, so the footer says "50+"');
    await page.getByLabel('Search').fill(tag);
    const footer = page.getByText(/^Showing \d+–\d+ of \d+\+?$/);
    await expect(footer).toHaveText('Showing 1–25 of 50+');
    await highlight(footer);
    await expect(page.getByRole('button', { name: 'Previous page' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Page 1' })).toHaveAttribute('aria-current', 'page');

    await narrate('Go to page 2 via the numbered pager');
    await page.getByRole('button', { name: 'Page 2' }).click();
    await expect(footer).toHaveText('Showing 26–50 of 50+');
    await expect(page.getByRole('button', { name: 'Page 2' })).toHaveAttribute('aria-current', 'page');

    await narrate('"Next" on the last loaded page fetches the next cursor page from the API');
    await page.getByRole('button', { name: 'Next page' }).click();
    await expect(footer).toHaveText('Showing 51–55 of 55');
    await expect(page.getByRole('button', { name: 'Next page' })).toBeDisabled();
    await expect(tableRows(page)).toHaveCount(5);

    await narrate('Previous goes back');
    await page.getByRole('button', { name: 'Previous page' }).click();
    await expect(footer).toHaveText('Showing 26–50 of 55');

    await narrate('Rows per page: 10 -> more pages; 100 -> everything on one page');
    await page.getByLabel('Rows per page').selectOption('10');
    await expect(tableRows(page)).toHaveCount(10);
    await expect(page.getByRole('button', { name: 'Page 6' })).toBeVisible();
    await page.getByLabel('Rows per page').selectOption('100');
    await expect(footer).toHaveText('Showing 1–55 of 55');
    await expect(tableRows(page)).toHaveCount(55);

    await narrate('Narrowing the search while on a late page clamps back to a valid page');
    await page.getByLabel('Rows per page').selectOption('10');
    await page.getByRole('button', { name: 'Page 6' }).click();
    await page.getByLabel('Search').fill(`${tag}ub`);
    await expect(footer).toHaveText('Showing 1–10 of 10');
    await expect(page.getByRole('button', { name: 'Page 1' })).toHaveAttribute('aria-current', 'page');
  });

  test('columns can be resized by dragging the handle or with the keyboard, and reset by double-click', async ({ page, narrate }) => {
    const handle = page.getByRole('separator', { name: 'Resize Email column' });
    await expect(handle).toBeVisible();
    const initial = Number(await handle.getAttribute('aria-valuenow'));
    expect(initial).toBe(300);

    await narrate('Drag the Email column border to the right');
    const box = (await handle.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 90, box.y + box.height / 2, { steps: 8 });
    await page.mouse.up();
    await expect.poll(async () => Number(await handle.getAttribute('aria-valuenow'))).toBeGreaterThan(initial + 40);
    await highlight(handle);

    await narrate('The keyboard works too: focus the handle and press Arrow keys');
    const afterDrag = Number(await handle.getAttribute('aria-valuenow'));
    await handle.focus();
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await expect.poll(async () => Number(await handle.getAttribute('aria-valuenow'))).toBe(afterDrag - 32);

    await narrate('Double-click resets the column to its default width');
    await handle.dblclick();
    await expect.poll(async () => Number(await handle.getAttribute('aria-valuenow'))).toBe(initial);

    await narrate('The actions column is pinned and not resizable');
    await expect(page.getByRole('separator', { name: 'Resize Actions column' })).toHaveCount(0);
  });
});
