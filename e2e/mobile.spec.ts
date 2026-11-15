// Phone width: bottom navigation, no sideways scroll, workspace still usable.

import { expect, test } from '@playwright/test'
import { openDemoSession, signIn } from './helpers'

const noSidewaysScroll = () => document.documentElement.scrollWidth <= window.innerWidth + 1

test('home and workspace fit a phone screen', async ({ page }) => {
  await signIn(page)
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible()
  expect(await page.evaluate(noSidewaysScroll)).toBe(true)

  await openDemoSession(page)
  expect(await page.evaluate(noSidewaysScroll)).toBe(true)
  await page.getByRole('tab', { name: /Notes/ }).click()
  await expect(page.getByPlaceholder(/Which attempt felt closest/)).toBeVisible()
})
