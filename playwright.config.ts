import { defineConfig, devices } from '@playwright/test'

import { e2eResetToken } from './e2e/test-environment.js'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: Boolean(process.env['CI']),
  retries: process.env['CI'] ? 1 : 0,
  workers: 1,
  reporter: process.env['CI'] ? 'line' : 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      command: 'pnpm --filter @react-resilience/fault-api dev',
      env: {
        ...process.env,
        LAB_TEST_RESET_TOKEN: e2eResetToken,
      },
      name: 'fault-api',
      reuseExistingServer: !process.env['CI'],
      timeout: 120_000,
      url: 'http://127.0.0.1:3001/health/live',
    },
    {
      command:
        'pnpm --filter @react-resilience/web dev --host 127.0.0.1 --port 4173',
      name: 'web',
      reuseExistingServer: !process.env['CI'],
      timeout: 120_000,
      url: 'http://127.0.0.1:4173',
    },
  ],
})
