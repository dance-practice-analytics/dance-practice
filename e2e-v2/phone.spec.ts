// Phone width (390 × 844, project v2-phone): dashboard and review fit the screen and use
// the bottom bar. Read-only.

import { expect, test, type Page } from '@playwright/test'
import { main, openLatestReview, requireTestAccount, signIn } from './helpers'

requireTestAccount()

test.beforeEach(async ({ page }) => {
  await signIn(page)
})

async function expectNoSideScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(overflow).toBeLessThanOrEqual(1)
}

test('phone dashboard: bottom bar, latest session, no sideways scroll', async ({ page }) => {
  const bar = page.locator('nav.bnav')
  await expect(bar).toBeVisible()
  await expect(bar.getByRole('link', { name: /Library/ })).toBeVisible()
  await expect(page.locator('nav.v2-side')).toBeHidden()
  const m = main(page)
  await expect(m.getByRole('region').filter({ hasText: /Latest session ·/ })).toBeVisible()
  await expect(m.getByRole('link', { name: /^Attempt \d+\s*,/ }).first()).toBeVisible()
  await expectNoSideScroll(page)
})

test('phone review: skeleton, phases and measurements fit the screen', async ({ page }) => {
  await openLatestReview(page)
  const m = main(page)
  await expect(m.getByRole('img', { name: /^Tracked pose skeleton of attempt \d+/ })).toBeVisible()
  await expect(m.getByRole('button', { name: 'Choose the file again' }).first()).toBeVisible()
  await expect(m.getByRole('group', { name: 'Phases' })).toBeVisible()
  // On phones the measurements are a plain section under the stage (no sidebar).
  const heading = m.getByRole('heading', { name: 'Measurements' })
  await heading.scrollIntoViewIfNeeded()
  await expect(heading).toBeVisible()
  await expect(m.getByText('Torso lean').first()).toBeVisible()
  await expect(m.getByRole('textbox', { name: 'My note on this attempt' })).toBeVisible()
  await expectNoSideScroll(page)
})
