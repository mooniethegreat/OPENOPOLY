import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 90000,
  expect: { timeout: 10000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  outputDir: '.runtime/playwright-results',
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://127.0.0.1:3199',
    channel: 'chrome',
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    viewport: { width: 1440, height: 1050 },
  },
  webServer: process.env.E2E_BASE_URL ? undefined : {
    command: process.env.E2E_SKIP_BUILD ? 'node server/index.js' : 'npm run build && node server/index.js',
    url: 'http://127.0.0.1:3199/api/health',
    timeout: 120000,
    reuseExistingServer: false,
    env: { PORT: '3199', HOST: '127.0.0.1', STORE_PATH: '.runtime/e2e-rooms.json', PUBLIC_ORIGIN: '' },
  },
});
