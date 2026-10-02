// @ts-check
import { defineConfig, devices } from '@playwright/test';

// Targets the running dev app (docker compose: the app container, http://localhost:3000). Nothing here
// starts a server. Run the fixture command first: `npm run db:fixtures` (see README.md).
export default defineConfig({
  testDir: './e2e',

  // The cases share one database and the same fixture accounts, so they run one at a time.
  workers: 1,
  fullyParallel: false,
  // A failure is a failure; a retry would hide a flaky case.
  retries: 0,

  // `next dev` compiles each route on its first request, so a first visit is slow.
  timeout: 60_000,
  expect: { timeout: 10_000 },

  globalSetup: './e2e/support/preflight.js',

  reporter: [
    ['./e2e/support/verdict-reporter.js'],
    ['json', { outputFile: 'test-results/results.json' }],
    ['html', { open: 'never' }],
  ],

  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:3000',
    navigationTimeout: 45_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
