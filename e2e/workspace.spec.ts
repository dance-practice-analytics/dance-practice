// The review workspace: video sync, gaps, autosave, export and delete.

import { expect, test } from '@playwright/test'
import { openDemoSession, signIn, transportTime } from './helpers'

test.beforeEach(async ({ page }) => {
  await signIn(page)
  await openDemoSession(page)
})

test('the clip plays in step with the clock and follows seeks', async ({ page }) => {
  const video = page.locator('.stage-video')
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThanOrEqual(2)

  await page.keyboard.press('Space')
  await page.waitForTimeout(1500)
  await page.keyboard.press('Space')
  await page.waitForTimeout(300)
  const clockT = await transportTime(page)
  const videoT = await video.evaluate((v: HTMLVideoElement) => v.currentTime)
  expect(clockT).toBeGreaterThan(5.5)
  expect(Math.abs(videoT - clockT)).toBeLessThan(0.1)

  // Scrub on the timeline: the clip seeks to the same time.
  const lanes = page.locator('.tl-lanes')
  const box = (await lanes.boundingBox())!
  await page.mouse.click(box.x + box.width * 0.6, box.y + 40)
  await expect.poll(async () => Math.abs((await video.evaluate((v: HTMLVideoElement) => v.currentTime)) - (await transportTime(page)))).toBeLessThan(0.1)
})

test('B follows A phase by phase in side-by-side compare', async ({ page }) => {
  await page.getByRole('tab', { name: 'Compare A/B' }).click()
  const videos = page.locator('.stage-video')
  await expect(videos).toHaveCount(2)
  await page.waitForTimeout(800)
  const [a, b] = await videos.evaluateAll((vs) => vs.map((v) => (v as HTMLVideoElement).currentTime))
  // A is attempt 1 (early in the clip), B attempt 3 (around 20 s): same phase, different source times.
  expect(a).toBeLessThan(10)
  expect(b).toBeGreaterThan(18)
})

test('video and skeleton can be switched off, and the pose still shows without video', async ({ page }) => {
  await page.getByRole('button', { name: 'Skeleton', exact: true }).click()
  await expect(page.locator('.stage-video')).toHaveCount(1)
  await page.getByRole('button', { name: 'Video', exact: true }).click()
  await expect(page.locator('.stage-video')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Skeleton', exact: true })).toHaveCount(0)
})

test('missing tracking shows as a gap, never a made-up value', async ({ page }) => {
  await page.getByRole('tab', { name: /Attempts/ }).click()
  // Attempt 4 has a tracking gap, so its time on relevé can't be measured.
  const card = page.locator('.attempt-card').nth(3)
  await expect(card).toContainText('unavailable')
  await expect(page.locator('.tl-q-missing').first()).toBeAttached()
})

test('notes autosave and survive a reload', async ({ page }) => {
  await page.getByRole('tab', { name: /Notes/ }).click()
  await page.getByPlaceholder(/Which attempt felt closest/).fill('Saved by the e2e test')
  await expect(page.locator('.save')).toContainText(/Saved/, { timeout: 5000 })
  await page.reload()
  await page.getByRole('tab', { name: /Notes/ }).click()
  await expect(page.getByPlaceholder(/Which attempt felt closest/)).toHaveValue('Saved by the e2e test')
})

test('export gives explicit nulls with a quality reason', async ({ page }) => {
  await page.getByRole('button', { name: 'Session options' }).click()
  const download = page.waitForEvent('download')
  await page.getByRole('menuitem', { name: 'Export measurements (CSV)' }).click()
  const file = await download
  const csv = await (await file.createReadStream()).toArray().then((c) => Buffer.concat(c).toString('utf8'))
  expect(csv.split('\n')[0]).toContain('quality_reason')
  expect(csv).toMatch(/,,false,no_pose_tracked/)
})

test('delete needs the word "delete" and removes the session', async ({ page }) => {
  await page.getByRole('button', { name: 'Session options' }).click()
  await page.getByRole('menuitem', { name: 'Delete session…' }).click()
  const remove = page.getByRole('button', { name: 'Delete permanently' })
  await expect(remove).toBeDisabled()
  await page.getByLabel(/Type delete to confirm/).fill('delete')
  await remove.click()
  await expect(page).toHaveURL(/#\/$/)
  await expect(page.locator('.st-row:not(.st-headrow)')).toHaveCount(4)
})
