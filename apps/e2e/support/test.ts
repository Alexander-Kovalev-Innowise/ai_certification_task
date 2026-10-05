import * as fs from 'node:fs';
import * as path from 'node:path';

import { expect, test as base, type Page } from '@playwright/test';

import { ApiClient } from './api';
import { uid, uniqueEmail, uniqueName, strongPassword } from './ids';
import { Mailbox } from './mailbox';
import { highlight, narrate } from './narrate';
import { SEED } from './seed';
import { loginAs, shell } from './ui';

export const VIDEOS_DIR = path.resolve(__dirname, '..', 'videos');

function slug(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 120) || 'test'
  );
}

interface TestFixtures {
  /** Typed fetch client for the e2e API (http://localhost:3100). */
  api: ApiClient;
  /** Dev mailbox client (MAIL_PROVIDER=dev): waitFor(to), linkTo(to, /pattern/), clear(). */
  mailbox: Mailbox;
  /** Shows a ~1.2s caption overlay on `page` so the video explains the step. */
  narrate: (text: string, ms?: number) => Promise<void>;
  /** Fills the real login form with the given credentials. */
  loginAs: (email: string, password: string) => Promise<void>;
  /** App-shell helpers bound to `page` (sidebar, user menu, theme toggle). */
  shell: ReturnType<typeof shell>;
}

interface WorkerFixtures {
  /** Seeded Super Admin credentials (from SEED_SUPER_ADMIN_* env). */
  seed: typeof SEED;
}

/**
 * The `test` every e2e spec must import. On top of Playwright's own fixtures it
 * (a) records every page, and (b) after the test copies each recording to
 * apps/e2e/videos/<spec-file>/<test-title-slug>.webm (a stable, human-readable path).
 */
export const test = base.extend<TestFixtures, WorkerFixtures>({
  seed: [async ({}, use) => use(SEED), { scope: 'worker' }],

  api: async ({}, use) => use(new ApiClient()),

  mailbox: async ({}, use) => use(new Mailbox()),

  page: async ({ page }, use, testInfo) => {
    const pages: Page[] = [page];
    page.context().on('page', (p) => pages.push(p));

    await use(page);

    // Videos are finalised when their page closes. Close, then copy to a stable path.
    const specName = path.basename(testInfo.file).replace(/\.spec\.[jt]sx?$/, '');
    const title = testInfo.titlePath.slice(1).join(' - ');
    const fileBase = slug(title) + (testInfo.retry > 0 ? `-retry${testInfo.retry}` : '');
    const dir = path.join(VIDEOS_DIR, specName);
    fs.mkdirSync(dir, { recursive: true });

    for (const [i, p] of pages.entries()) {
      const video = p.video();
      if (!video) continue;
      await p.close().catch(() => undefined);
      const dest = path.join(dir, `${fileBase}${i === 0 ? '' : `-page${i + 1}`}.webm`);
      try {
        await video.saveAs(dest);
      } catch (e) {
        console.warn(`[e2e] could not save video ${dest}: ${String(e)}`);
      }
    }
  },

  narrate: async ({ page }, use) => use((text, ms) => narrate(page, text, ms)),

  loginAs: async ({ page }, use) => use((email, password) => loginAs(page, email, password)),

  shell: async ({ page }, use) => use(shell(page)),
});

export { expect, highlight, narrate, loginAs, shell, SEED, uid, uniqueEmail, uniqueName, strongPassword };
export { ApiClient } from './api';
export type { ApiSession } from './api';
export { Mailbox } from './mailbox';
export * from './arrange';
export * from './db';
export * from './family';
