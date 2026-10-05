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

  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],

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
