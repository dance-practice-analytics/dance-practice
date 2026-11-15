import { expect, type Page } from '@playwright/test'

/** Mock sign-in values from the README (any code like P07, passcode "practice"). */
export const PASSCODE = 'practice'

export async function signIn(page: Page, code = 'P07', path = '/#/signin') {
  await page.goto(path)
  await page.getByLabel('Participant code').fill(code)
  await page.getByLabel('Passcode').fill(PASSCODE)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: `Welcome back, ${code}` })).toBeVisible()
}

/** Open the seeded reference session (Oct 28), which has a clip and confirmed attempts. Onboarding is marked as seen. */
export async function openDemoSession(page: Page) {
  await page.evaluate(() => localStorage.setItem('dad-onboarded-v1', '1'))
  await page.goto('/#/sessions/demo-session')
  await expect(page.locator('.stage-panel')).toBeVisible()
}

/** Wizard → processing → confirm → workspace, using the sample clip and synthetic export. Returns the session id. */
export async function createSession(page: Page, goal: string): Promise<string> {
  await page.getByRole('button', { name: '+ New session' }).click()
  await page.getByPlaceholder('e.g. Keep my knees over my toes as I rise').fill(goal)
  await page.getByRole('button', { name: 'Continue →' }).click()
  await page.getByRole('button', { name: 'Continue →' }).click()
  await page.getByText('I have permission to use this footage').click()
  await page.getByRole('button', { name: 'Create session →' }).click()
  await expect(page).toHaveURL(/#\/sessions\/[^/]+\/processing/)
  const id = decodeURIComponent(page.url().split('/sessions/')[1].split('/')[0])
  await page.getByRole('button', { name: 'Use the synthetic export' }).click()
  await page.getByRole('button', { name: 'Next: confirm your attempts →' }).click({ timeout: 20_000 })
  await expect(page).toHaveURL(/\/confirm$/)
  return id
}

/** Time shown in the playback bar, in seconds. */
export async function transportTime(page: Page): Promise<number> {
  const text = (await page.locator('.transport-time b').textContent()) ?? '0:00.0'
  const [m, s] = text.split(':')
  return Number(m) * 60 + Number(s)
}
