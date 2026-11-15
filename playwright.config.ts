import { defineConfig, devices } from '@playwright/test'

const PORT = 5180

// End-to-end tests of the whole flow against the in-browser mock API.
// Uses the installed Chrome locally; run `npx playwright install chromium` and set PW_BUNDLED=1 where Chrome isn't available.
export default defineConfig({
  testDir: 'e2e',
  globalSetup: './e2e/global-setup.ts',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', testIgnore: /mobile\.spec/, use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, channel: process.env.PW_BUNDLED ? undefined : 'chrome' } },
    { name: 'mobile', testMatch: /mobile\.spec/, use: { ...devices['Pixel 7'], channel: process.env.PW_BUNDLED ? undefined : 'chrome' } },
  ],
  webServer: {
    command: `npm run dev -- --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
  },
})
