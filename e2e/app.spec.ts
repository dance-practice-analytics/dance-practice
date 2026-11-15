// Sign-in, navigation, progress and the study panel.

import { expect, test } from '@playwright/test'
import { PASSCODE, signIn } from './helpers'

test('a wrong passcode says what to do, and nothing opens', async ({ page }) => {
  await page.goto('/#/signin')
  await page.getByLabel('Participant code').fill('P07')
  await page.getByLabel('Passcode').fill('nope')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('alert')).toContainText('don’t match')
  await page.goto('/#/progress')
  await expect(page).toHaveURL(/#\/signin/)
})

test('"Explore the demo" opens home with the latest session replayed', async ({ page }) => {
  await page.goto('/#/signin')
  await page.getByRole('button', { name: 'Explore the demo' }).click()
  await expect(page.getByRole('heading', { name: 'Welcome back, P07' })).toBeVisible()
  await expect(page.locator('.spotlight .rhythm-row')).toHaveCount(4)
  await expect(page.locator('.spot-hud')).toContainText('Attempt')
})

test('home shows the next focus, headline numbers and every session', async ({ page }) => {
  await signIn(page)
  await expect(page.locator('.focus-text')).toHaveText('“Keep my knees over my toes as I rise”')
  await expect(page.locator('.kpi')).toHaveCount(4)
  await expect(page.locator('.kpi').first()).toContainText('5')
  await expect(page.locator('.strip svg')).toBeVisible()
  await page.getByRole('button', { name: 'Table', exact: true }).click()
  await expect(page.locator('.data-table')).toContainText('not compared')
})

test('progress has one chart per measurement and reacts to the phase', async ({ page }) => {
  await signIn(page)
  await page.getByRole('link', { name: 'Progress' }).click()
  await expect(page.locator('.multiple')).toHaveCount(5)
  await page.getByRole('button', { name: 'Plié', exact: true }).click()
  // Shoulder–ear space isn't measured during the plié, and the page says so.
  await expect(page.locator('.multiple', { hasText: 'Shoulder' })).toContainText('isn’t measured during Plié')
})

test('sign out returns to sign-in and the session is gone', async ({ page }) => {
  await signIn(page)
  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
  await page.goto('/#/')
  await expect(page).toHaveURL(/#\/signin/)
})

test('study panel: next participant starts from the same state', async ({ page }) => {
  await signIn(page, 'P07', '/#/signin?study=on')
  const panel = page.getByRole('complementary', { name: 'Usability study panel' })
  await expect(panel).toBeVisible()
  await panel.getByRole('button', { name: /Start a session/ }).click()
  await panel.getByRole('button', { name: 'Completed' }).click()
  await expect(panel).toContainText('1/6 tasks')

  await panel.getByRole('button', { name: 'Next participant…' }).click()
  await expect(panel.getByRole('textbox')).toHaveValue('P08')
  const reset = panel.getByRole('button', { name: 'Reset for P08' })
  await expect(reset).toBeDisabled()
  await panel.getByText('Discard it').click()
  await reset.click()

  await expect(page).toHaveURL(/#\/signin\?code=P08/)
  await expect(page.getByLabel('Participant code')).toHaveValue('P08')
  await expect(panel).toContainText('0/6 tasks')
  await page.getByLabel('Passcode').fill(PASSCODE)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.locator('.st-row:not(.st-headrow)')).toHaveCount(5)
})
