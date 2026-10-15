import { test, expect, highlight, shell } from '../support/test';
// The page-title registry itself is the source of truth for expected tab titles.
import { formatDocumentTitle, resolvePageMeta } from '../../client/src/lib/pageMeta';

const expectedTitle = (pathname: string) => formatDocumentTitle(resolvePageMeta(pathname).title);

test.describe('App shell UX (Super Admin)', () => {
  test.beforeEach(async ({ seed, loginAs }) => {
    await loginAs(seed.superAdmin.email, seed.superAdmin.password);
  });

  test('sidebar collapse/expand persists across a reload', async ({ page, narrate }) => {
    const app = shell(page);
    await expect(app.sidebar).toBeVisible();
    expect(await app.isCollapsed()).toBe(false);

    await narrate('Collapse the sidebar');
    await app.collapseToggle.click();
    await expect(app.sidebar).toHaveAttribute('data-collapsed', 'true');

    await narrate('Reload - it must stay collapsed');
    await page.reload();
    await expect(app.sidebar).toHaveAttribute('data-collapsed', 'true');
    await expect(app.collapseToggle).toHaveAccessibleName('Expand sidebar');

    await narrate('Expand again - persists too');
    await app.collapseToggle.click();
    await expect(app.sidebar).toHaveAttribute('data-collapsed', 'false');
    await page.reload();
    await expect(app.sidebar).toHaveAttribute('data-collapsed', 'false');
  });

  test('sidebar is not remounted when navigating /dashboard -> /users', async ({ page, narrate }) => {
    const app = shell(page);
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(app.sidebar).toBeVisible();
    await app.markSidebar();

    await narrate('Navigate Dashboard -> Users via the sidebar (client-side)');
    await app.goTo('Users');
    await expect(page).toHaveURL(/\/users$/);
    await expect(page.getByRole('table', { name: 'Users' })).toBeVisible();

    expect(await app.sidebarIsSameElement(), 'sidebar DOM node was re-created (remounted)').toBe(true);
    await narrate('Same sidebar element - no remount, no flicker');
    await app.goTo('Dashboard');
    await expect(page).toHaveURL(/\/dashboard/);
    expect(await app.sidebarIsSameElement()).toBe(true);
  });

  test('tab titles match the page-meta registry', async ({ page, narrate }) => {
    const app = shell(page);
    await expect(page).toHaveTitle(expectedTitle('/dashboard'));
    await narrate(`Dashboard tab title: "${await page.title()}"`);

    await app.goTo('Users');
    await expect(page).toHaveTitle(expectedTitle('/users'));
    await narrate(`Users tab title: "${await page.title()}"`);

    await app.goTo('Impersonation History');
    await expect(page).toHaveURL(/\/impersonation-history/);
    await expect(page).toHaveTitle(expectedTitle('/impersonation-history'));

    await page.goto('/account/profile');
    await expect(page).toHaveTitle(expectedTitle('/account/profile'));
  });

  test('users table shows its column headers', async ({ page, narrate }) => {
    await page.goto('/users');
    const table = page.getByRole('table', { name: 'Users' });
    await expect(table).toBeVisible();
    await narrate('Users table column headers');

    for (const header of ['Name', 'Email', 'Role', 'Status', 'Actions']) {
      await expect(table.getByRole('columnheader', { name: new RegExp(`^${header}( Resize|$)`) })).toBeVisible();
    }
    await highlight(table.getByRole('row').first());
    // The seeded Super Admin is always in the directory (oldest row, so look it up via search - the table is paginated).
    await page.getByLabel('Search').fill('Super Admin');
    await expect(table.getByRole('row', { name: 'Super Admin' })).toBeVisible();
  });

  test('edit icon opens the user detail card', async ({ page, narrate }) => {
    await page.goto('/users');
    await page.getByLabel('Search').fill('Super Admin');
    const row = page.getByRole('table', { name: 'Users' }).getByRole('row', { name: 'Super Admin' });
    const edit = row.getByRole('link', { name: 'Edit user' });
    await expect(edit).toBeVisible();
    await narrate('Click the edit icon on the Super Admin row');
    await highlight(edit);
    await edit.click();

    await expect(page).toHaveURL(/\/users\/[0-9a-f-]{36}/);
    await expect(page.getByRole('heading', { name: 'Edit user' })).toBeVisible();
    await expect(page.getByText('Super Admin').first()).toBeVisible();
    // The detail page overrides the registry title with the user's name (usePageMeta).
    await expect(page).toHaveTitle('Edit Super Admin | PracticePerfect');
  });
});
