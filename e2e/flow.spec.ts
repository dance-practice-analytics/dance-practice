// The whole dancer flow, as in the usability study script (T1–T6).

import { expect, test } from '@playwright/test'
import { createSession, signIn } from './helpers'

test('sign in, record, confirm, compare, reflect, and see it on Home', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(String(e)))

  await signIn(page)
  await expect(page.locator('.st-row:not(.st-headrow)')).toHaveCount(5)

  // T1: new session with a goal of my own.
  await createSession(page, 'Keep my heels level at the top')

  // T2: every suggested attempt has to be checked before confirming.
  const confirm = page.getByRole('button', { name: /Confirm \d+ attempts/ })
  await expect(confirm).toBeDisabled()
  const unchecked = page.getByText('Mark as checked', { exact: true })
  while ((await unchecked.count()) > 0) await unchecked.first().click()
  await expect(confirm).toBeEnabled()
  await confirm.click()

  // First visit to the workspace shows the onboarding cards.
  const cards = page.getByRole('dialog', { name: 'How to read this' })
  await expect(cards).toBeVisible()
  await cards.getByRole('button', { name: 'Next', exact: true }).click()
  await cards.getByRole('button', { name: 'Next', exact: true }).click()
  await cards.getByRole('button', { name: 'Start reviewing' }).click()
  await expect(page.getByRole('button', { name: 'Keep my heels level at the top' })).toBeVisible()

  // T3: the clip and the measurements are there.
  await expect(page.locator('.stage-video')).toHaveCount(1)
  await expect(page.locator('.track')).toHaveCount(4)

  // T4: compare attempt 1 and 3 during the hold.
  await page.getByRole('tab', { name: 'Compare A/B' }).click()
  await expect(page.getByRole('tab', { name: /Compare/, selected: true }).first()).toBeVisible()
  await expect(page.locator('.stage-pair .stage')).toHaveCount(2)
  await expect(page.locator('.cmp-row')).toHaveCount(5)
  await expect(page.locator('.cmp-change').first()).toHaveText(/^B is /)

  // T6: mark a moment, then finish with a reflection and a next goal.
  await page.keyboard.press('m')
  await page.getByRole('button', { name: 'Finish & reflect' }).first().click()
  const sheet = page.getByRole('dialog', { name: 'Finish and reflect' })
  await sheet.getByLabel('Session reflection').fill('Attempt 3 felt steadier at the top.')
  await sheet.getByLabel('Goal for next session').fill('Rise slower and stay level')
  await sheet.getByRole('button', { name: 'Save to journal' }).click()

  await expect(page).toHaveURL(/#\/$/)
  await expect(page.locator('.focus-text')).toHaveText('“Rise slower and stay level”')
  await expect(page.locator('.st-row:not(.st-headrow)')).toHaveCount(6)
  await expect(page.locator('.st-row').nth(1)).toContainText('Attempt 3 felt steadier at the top.')
  expect(errors).toEqual([])
})

test('a mismatched pose export fails with a way forward, and a retry works', async ({ page }) => {
  await signIn(page)
  await page.getByRole('button', { name: '+ New session' }).click()
  await page.getByPlaceholder('e.g. Keep my knees over my toes as I rise').fill('Test the error path')
  await page.getByRole('button', { name: 'Continue →' }).click()
  await page.getByRole('button', { name: 'Continue →' }).click()
  await page.getByText('I have permission to use this footage').click()
  await page.getByRole('button', { name: 'Create session →' }).click()

  await page.getByRole('button', { name: 'Try a mismatched export' }).click()
  const alert = page.getByRole('alert')
  await expect(alert).toBeVisible({ timeout: 15_000 })
  await expect(alert).toContainText(/export/i)
  await alert.getByRole('button', { name: 'Upload another export' }).click()
  await page.getByRole('button', { name: 'Use the synthetic export' }).click()
  await expect(page.getByRole('button', { name: 'Next: confirm your attempts →' })).toBeVisible({ timeout: 20_000 })
})

test('the wizard needs a goal and the footage permission', async ({ page }) => {
  await signIn(page)
  await page.getByRole('button', { name: '+ New session' }).click()
  await expect(page.getByRole('button', { name: 'Continue →' })).toBeDisabled()
  await page.getByPlaceholder('e.g. Keep my knees over my toes as I rise').fill('A goal')
  await page.getByRole('button', { name: 'Continue →' }).click()
  await page.getByRole('button', { name: 'Continue →' }).click()
  await expect(page.getByRole('button', { name: 'Create session →' })).toBeDisabled()
  await page.getByText('I have permission to use this footage').click()
  await expect(page.getByRole('button', { name: 'Create session →' })).toBeEnabled()
})
