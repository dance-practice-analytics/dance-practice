import { defineConfig, devices } from '@playwright/test'
import { hasTestAccount, readLocalEnv } from './e2e-v2/env'

const PORT = 5190
const OUT_DIR = 'dist-e2e-v2'

// Smoke tests of the v2 app against the real Supabase project, signed in as the test
// account from .env.local (TEST_ACCOUNT_EMAIL / TEST_ACCOUNT_PASSWORD, never printed).
// Without those credentials or the Supabase env every test is skipped and no server
// starts, so CI stays green. Read-only, except one attempt note that is written and
// restored. One worker: the tests share one account and the machine is small.
const env = readLocalEnv()
const ready = hasTestAccount(env)
const chrome = process.env.PW_BUNDLED ? undefined : 'chrome'

export default defineConfig({
  testDir: 'e2e-v2',
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  outputDir: 'test-results/v2',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // The service worker would cache the build between runs.
    serviceWorkers: 'block',
    // No sign-in entrance overlay (it plays only with motion allowed and covers the page).
    contextOptions: { reducedMotion: 'reduce' },
  },
  projects: [
    { name: 'v2-desktop', testIgnore: /phone\.spec/, use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, channel: chrome } },
    { name: 'v2-phone', testMatch: /phone\.spec/, use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, channel: chrome } },
  ],
  // A production build with the Supabase env, in its own folder and on its own port, so
  // it never collides with `npm run dev` (5173) or the legacy e2e server (5180).
  webServer: ready
    ? {
        command: `npx vite build --outDir ${OUT_DIR} --emptyOutDir && npx vite preview --outDir ${OUT_DIR} --port ${PORT} --strictPort`,
        url: `http://localhost:${PORT}`,
        timeout: 240_000,
        reuseExistingServer: !process.env.CI,
      }
    : undefined,
})
