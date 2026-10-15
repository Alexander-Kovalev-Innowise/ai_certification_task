import { defineConfig } from '@playwright/test';

import { API_PORT, API_URL, CLIENT_PORT, CLIENT_URL } from './scripts/e2e-env.cjs';

const CI = !!process.env.CI;

/**
 * Isolated e2e stack - never touches the developer's own servers (3000/3001) or
 * database:
 *   API    -> http://localhost:3100  DB `practiceperfect_e2e`  (scripts/start-api.cjs)
 *   Client -> http://localhost:3101  talking to the API above  (scripts/start-client.cjs)
 *
 * Every test records a video (see support/test.ts for where the files end up).
 */
export default defineConfig({
  testDir: './tests',
  outputDir: './test-results',
  globalSetup: './global-setup.ts',

  // Shared database => strictly serial.
  workers: 1,
  fullyParallel: false,
  retries: 0,
  forbidOnly: CI,

  // slowMo (150ms/action) makes the videos watchable, so budgets are generous.
  timeout: 120_000,
  expect: { timeout: 10_000 },

  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],

  use: {
    baseURL: CLIENT_URL,
    viewport: { width: 1280, height: 720 },
    video: { mode: 'on', size: { width: 1280, height: 720 } },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: { slowMo: 150 },
    actionTimeout: 15_000,
    navigationTimeout: 60_000, // first hit of each route compiles in `next dev`
  },

  // `chromium` = the desktop suite (1280x720). `phone` and `tablet` re-run only the responsive specs (51-53) at a phone
  // (375x812, touch) and a tablet (768x1024, touch) viewport, with the video recorded at that size (spec "Mobile Requirements").
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' }, testIgnore: /\/5[123]-responsive-/ },
    {
      name: 'phone',
      testMatch: /\/5[12]-responsive-/,
      use: {
        browserName: 'chromium',
        viewport: { width: 375, height: 812 },
        isMobile: true,
        hasTouch: true,
        video: { mode: 'on', size: { width: 375, height: 812 } },
      },
    },
    {
      name: 'tablet',
      testMatch: /\/5[13]-responsive-/,
      use: {
        browserName: 'chromium',
        viewport: { width: 768, height: 1024 },
        isMobile: true,
        hasTouch: true,
        video: { mode: 'on', size: { width: 768, height: 1024 } },
      },
    },
  ],

  webServer: [
    {
      name: 'api',
      command: 'node scripts/start-api.cjs',
      cwd: __dirname,
      url: `${API_URL}/docs`,
      reuseExistingServer: !CI,
      timeout: 300_000,
      stdout: 'pipe',
      stderr: 'pipe',
      env: { E2E_API_PORT: String(API_PORT) },
    },
    {
      name: 'client',
      command: 'node scripts/start-client.cjs',
      cwd: __dirname,
      url: `${CLIENT_URL}/login`,
      reuseExistingServer: !CI,
      timeout: 300_000,
      stdout: 'pipe',
      stderr: 'pipe',
      env: { E2E_CLIENT_PORT: String(CLIENT_PORT) },
    },
  ],
});
