import { expect, test, type Page } from '@playwright/test'
import { hasTestAccount, testAccount } from './env'

/** Skips the whole file when .env.local has no Supabase env or no test account. */
export function requireTestAccount() {
  test.skip(!hasTestAccount(), 'No Supabase env or TEST_ACCOUNT_EMAIL / TEST_ACCOUNT_PASSWORD in .env.local')
}

/** The shell's page area (sidebar and phone bar excluded). */
export const main = (page: Page) => page.locator('main.v2-main')

/** Signs in as the test account through the real form and waits for the shell. */
export async function signIn(page: Page) {
  const { email, password } = testAccount()
  await page.goto('/#/signin')
  await page.locator('#si-email').fill(email)
  await page.locator('#si-pw').fill(password)
  await page.locator('button[type="submit"]').click()
  await expect(main(page)).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('.v2-entrance')).toHaveCount(0)
}

/** Opens the latest processed attempt in Review (`#/review` without an id). */
export async function openLatestReview(page: Page) {
  await go(page, '#/review')
  await expect(main(page).getByRole('heading', { level: 1, name: /^Attempt \d+$/ })).toBeVisible()
}

/**
 * Opens a relevé attempt in Review. The newest attempt of the test account is a synthetic
 * phrase sample (no phase ribbon, theme cards instead of measurements), so the checks of
 * the relevé screens pick one through the Library's movement filter.
 */
export async function openReleveReview(page: Page) {
  await go(page, '#/library')
  const m = main(page)
  // Desktop: the "Relevé" segment; phone: the "Relevé balance" chip.
  await m.getByRole('button', { name: /^Relevé( balance)?$/ }).first().click()
  await m.locator('a[href^="#/review/"]').first().click()
  await expect(m.getByRole('heading', { level: 1, name: /^Attempt \d+$/ })).toBeVisible()
}

/** Two relevé attempt ids from the Library (desktop: the tiles of the newest relevé sessions). */
export async function releveIds(page: Page): Promise<string[]> {
  await go(page, '#/library')
  const m = main(page)
  await m.getByRole('button', { name: /^Relevé( balance)?$/ }).first().click()
  await expect(m.locator('a[href^="#/review/"]').nth(1)).toBeVisible()
  const hrefs = await m.locator('a[href^="#/review/"]').evaluateAll((as) => as.map((a) => a.getAttribute('href') ?? ''))
  return [...new Set(hrefs.map((h) => h.split('/')[2]))].slice(0, 2)
}

/** Navigates by hash inside the running app (no reload, the session stays in memory). */
export async function go(page: Page, hash: string) {
  await page.evaluate((h) => {
    window.location.hash = h
  }, hash)
}
