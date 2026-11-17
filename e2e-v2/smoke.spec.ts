// Smoke tests of the live v2 app against the real Supabase project, as the test account.
// Read-only, except the attempt note round trip, which puts the original note back.
// Nothing here deletes data, changes the password or sends a question to Mika.

import { expect, test } from '@playwright/test'
import { go, main, openReleveReview, releveIds, requireTestAccount, signIn } from './helpers'

requireTestAccount()

test.beforeEach(async ({ page }) => {
  await signIn(page)
})

test('dashboard: greeting and the latest session with its attempts', async ({ page }) => {
  const m = main(page)
  await expect(m.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible()
  await expect(m.getByText(/^Good (morning|afternoon|evening)/)).toBeVisible()
  const latest = m.getByRole('region').filter({ hasText: /Latest session ·/ })
  await expect(latest).toBeVisible()
  await expect(latest.getByRole('heading', { level: 2 })).toHaveText(/ · Session \d+$/)
  await expect(latest.getByRole('link', { name: /^Attempt \d+\s*,/ }).first()).toBeVisible()
  await expect(latest.getByRole('link', { name: /^Review attempt \d+$/ })).toHaveAttribute('href', /^#\/review\//)
})

test('library: sessions grouped by subject with skeleton thumbnails', async ({ page }) => {
  await go(page, '#/library')
  const m = main(page)
  await expect(m.getByRole('heading', { level: 1, name: 'Library' })).toBeVisible()
  const clips = m.getByRole('region', { name: 'Clips by subject' })
  await expect(clips).toBeVisible()
  await expect(clips.getByText(/ · Session \d+/).first()).toBeVisible()
  const attempts = clips.getByRole('link', { name: /^Attempt \d+\s*,/ })
  expect(await attempts.count()).toBeGreaterThan(0)
  // Thumbnails are drawn from the saved keypoints (never a video frame).
  await expect(clips.locator('.thumb svg line').first()).toBeAttached()
  // The status filter narrows without writing anything.
  await m.getByRole('group', { name: 'Status' }).getByRole('button', { name: /^Done/ }).click()
  await expect(attempts.first()).toBeVisible()
})

test('review: skeleton stage, measurements, phases and the relink card', async ({ page }) => {
  await openReleveReview(page)
  const m = main(page)
  const stage = m.getByRole('region', { name: 'Video and timelines' })
  await expect(stage.getByRole('img', { name: /^Tracked pose skeleton of attempt \d+/ })).toBeVisible()
  // After a fresh sign-in the clip isn't in this tab: the page says so and offers to pick it again.
  const relink = stage.getByRole('region', { name: 'Video not on this device' })
  await expect(relink).toBeVisible()
  await expect(relink.getByRole('button', { name: 'Choose the file again' })).toBeVisible()
  // Phase ribbon: one button per phase ("Hold 1.2s phase", "Prep phase, 5.0 seconds", …).
  const phases = stage.getByRole('group', { name: 'Phases' })
  await expect(phases.getByRole('button', { name: /phase/ }).first()).toBeVisible()
  expect(await phases.getByRole('button').count()).toBeGreaterThan(1)
  const measures = m.getByRole('complementary', { name: 'Measurements' })
  await expect(measures).toBeVisible()
  await expect(measures.getByText('Torso lean')).toBeVisible()
  await expect(measures.getByText(/\d(\.\d)?°/).first()).toBeVisible()
  // Playing moves the shared clock; pause again.
  await stage.getByRole('button', { name: 'Play' }).click()
  await expect(stage.getByRole('button', { name: 'Pause' })).toBeVisible()
  await stage.getByRole('button', { name: 'Pause' }).click()
})

test('review: the attempt note autosaves, survives a reload and is put back', async ({ page }) => {
  await openReleveReview(page)
  const note = main(page).getByRole('textbox', { name: 'My note on this attempt' })
  const status = main(page).locator('#rev-note-status')
  await expect(note).toBeEditable()
  const original = await note.inputValue()
  const probe = `e2e note check ${Date.now()}`
  try {
    await note.fill(probe)
    await expect(status).toHaveText(/^\s*Saved/, { timeout: 15_000 })
    await page.reload()
    await expect(main(page).getByRole('textbox', { name: 'My note on this attempt' })).toHaveValue(probe)
  } finally {
    // Put the account back as it was, even if an assertion above failed.
    const again = main(page).getByRole('textbox', { name: 'My note on this attempt' })
    await again.fill(original)
    await expect(main(page).locator('#rev-note-status')).toHaveText(original.trim() ? /^\s*Saved/ : /No note yet/, { timeout: 15_000 })
  }
  await page.reload()
  await expect(main(page).getByRole('textbox', { name: 'My note on this attempt' })).toHaveValue(original)
})

test('compare: A and B pickers and the differences table', async ({ page }) => {
  // Two relevé attempts (the newest attempt is a phrase, compared on its own terms).
  const [a, b] = await releveIds(page)
  await go(page, `#/compare?a=${a}&b=${b}`)
  await expect(page).toHaveURL(/#\/compare\?a=[^&]+&b=/)
  const m = main(page)
  await expect(m.getByRole('heading', { level: 1, name: 'Compare attempts' })).toBeVisible()
  await expect(m.getByRole('combobox', { name: 'Attempt A' })).toBeVisible()
  await expect(m.getByRole('combobox', { name: 'Attempt B' })).toBeVisible()
  await expect(m.getByRole('img', { name: /^Tracked pose skeleton of A, / })).toBeVisible()
  await expect(m.getByRole('img', { name: /^Tracked pose skeleton of B, .*A dashed behind it/ })).toBeVisible()
  const diffs = m.getByRole('region', { name: 'Differences' })
  await expect(diffs.getByText('Descriptive only')).toBeVisible()
  const table = diffs.getByRole('table')
  await expect(table.getByRole('columnheader', { name: 'B compared with A' })).toBeVisible()
  await expect(table.getByRole('rowheader', { name: 'Torso lean' })).toBeVisible()
  // Neutral wording only ("B is 1.0° less lean"), never a grade.
  await expect(table.getByRole('cell', { name: /^B is |^No difference|^Not compared/ }).first()).toBeVisible()
  await expect(table).not.toContainText(/better|worse|score/i)
})

test('progress: session labels and date presets', async ({ page }) => {
  await go(page, '#/progress')
  const m = main(page)
  await expect(m.getByRole('heading', { level: 1, name: 'Progress' })).toBeVisible()
  // The newest movement is the synthetic phrase sample; the session table is the relevé view.
  await m.getByRole('tablist', { name: 'Movement' }).getByRole('tab', { name: 'Relevé balance' }).click()
  const sessions = m.getByRole('region', { name: 'Sessions' })
  await expect(sessions.getByRole('link', { name: /^Session \d+$/ }).first()).toBeVisible()
  await expect(m.getByRole('figure').first()).toBeVisible()
  const dates = m.getByRole('radiogroup', { name: 'Dates' })
  for (const preset of ['Last 7 days', 'Last 30 days', 'All', 'Custom…']) {
    await expect(dates.getByRole('radio', { name: preset })).toBeVisible()
  }
  await dates.getByRole('radio', { name: 'Last 30 days' }).click()
  await expect(dates.getByRole('radio', { name: 'Last 30 days' })).toBeChecked()
  await dates.getByRole('radio', { name: 'All' }).click()
  await expect(dates.getByRole('radio', { name: 'All' })).toBeChecked()
  await expect(sessions.getByRole('link', { name: 'Session 1', exact: true })).toBeVisible()
})

test('settings: account, privacy and data sections (nothing is changed)', async ({ page }) => {
  await go(page, '#/settings')
  const m = main(page)
  await expect(m.getByRole('heading', { level: 1, name: 'Settings & data' })).toBeVisible()
  for (const name of ['Account', 'Appearance', 'Privacy choices', 'Your data', 'About & privacy']) {
    await expect(m.getByRole('region', { name })).toBeVisible()
  }
  // Present, never pressed here.
  await expect(m.getByRole('button', { name: 'Change password' })).toBeVisible()
  await expect(m.getByRole('button', { name: 'Delete account…' })).toBeVisible()
  await expect(m.getByRole('button', { name: 'Export JSON' })).toBeVisible()
  await expect(m.getByRole('region', { name: 'Your data' })).toContainText(/\d+ sessions? · \d+ attempts?/)
})

test('mika: says honestly whether it is connected, and sends nothing on its own', async ({ page }) => {
  await go(page, '#/chat')
  const m = main(page)
  await expect(m.getByRole('heading', { level: 1, name: 'Mika' })).toBeVisible()
  await expect(m.getByRole('heading', { name: 'Never shared' })).toBeVisible()
  await expect(m.getByText('Checking whether Mika is available…')).toHaveCount(0, { timeout: 20_000 })
  const box = m.getByRole('textbox', { name: 'Ask a question about your measurements' })
  const send = m.getByRole('button', { name: 'Send' })
  await expect(send).toBeDisabled()
  const notConnected = m.getByText('Mika isn’t connected yet.')
  if (await notConnected.isVisible()) {
    // Honest not-connected state: copy says so and sending stays off even with a question typed.
    await expect(m).toContainText('Nothing is shared now')
    if (await box.isEditable()) await box.fill('What changed since attempt 1?')
    await expect(send).toBeDisabled()
  } else {
    // The function is deployed: the composer works, but this test never sends (no model call).
    test.info().annotations.push({ type: 'mika', description: 'connected: composer enabled, nothing sent' })
    await box.fill('What changed since attempt 1?')
    await expect(send).toBeEnabled()
    await box.fill('')
  }
})

test('sign out returns to the sign-in form and the pages are closed', async ({ page }) => {
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Sign out' }).click()
  await expect(page.locator('#si-email')).toBeVisible()
  await go(page, '#/library')
  await expect(page.locator('#si-email')).toBeVisible()
  await expect(page.locator('main.v2-main')).toHaveCount(0)
})
