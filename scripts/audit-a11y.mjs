// Accessibility audit of the v2 app (NFR-13): axe-core (WCAG 2.0/2.1 A + AA rules) on
// every main screen in light and dark, plus a keyboard pass (Tab through the page, check
// each stop shows a focus indicator, list visible controls Tab never reaches).
//
//   node scripts/audit-a11y.mjs [--pages dashboard,library] [--themes light] [--json out.json]
//
// Needs .env.local with the Supabase URL/key and TEST_ACCOUNT_EMAIL / TEST_ACCOUNT_PASSWORD
// (the test account holds only synthetic clips). The credentials are read here and typed
// into the sign-in form; they are never printed. Uses the installed Chrome, one browser.

import { readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'vite'
import { chromium } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

const args = process.argv.slice(2)
const opt = (name) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/))
    .filter(Boolean)
    .map((m) => [m[1], m[2].replace(/^["']|["']$/g, '')]),
)
if (!env.TEST_ACCOUNT_EMAIL || !env.TEST_ACCOUNT_PASSWORD) throw new Error('TEST_ACCOUNT_EMAIL / TEST_ACCOUNT_PASSWORD missing in .env.local')

const PAGES = {
  dashboard: '#/dashboard',
  library: '#/library',
  import: '#/import',
  review: '#/review',
  compare: '#/compare',
  progress: '#/progress',
  notes: '#/notes',
  chat: '#/chat',
  settings: '#/settings',
}
const pages = opt('--pages')?.split(',') ?? Object.keys(PAGES)
const themes = opt('--themes')?.split(',') ?? ['light', 'dark']

const server = await createServer({ server: { port: 5199, strictPort: false }, logLevel: 'error' })
await server.listen()
const base = server.resolvedUrls.local[0]
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const report = []

async function audit(page, name, theme) {
  // Data hooks settle and skeletons / "Loading…" lines go (keypoints come from Storage).
  await page
    .waitForFunction(() => !document.querySelector('[aria-busy="true"]') && !/Loading/.test(document.querySelector('main')?.innerText ?? ''), null, { timeout: 30_000 })
    .catch(() => console.log(`  (${name}: still loading after 30 s)`))
  await page.waitForTimeout(800)
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice']).analyze()
  const violations = axe.violations.map((v) => ({
    id: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes.slice(0, 6).map((n) => ({ target: n.target.join(' '), summary: n.failureSummary?.split('\n').slice(0, 3).join(' ') })),
    count: v.nodes.length,
  }))

  // Keyboard pass.
  const keyboard = await page.evaluate(() => {
    document.activeElement?.blur()
    window.scrollTo(0, 0)
    return null
  })
  void keyboard
  const stops = []
  const seen = new Set()
  for (let i = 0; i < 120; i++) {
    await page.keyboard.press('Tab')
    const info = await page.evaluate(() => {
      const el = document.activeElement
      if (!el || el === document.body) return null
      if (!el.dataset.a11yId) el.dataset.a11yId = String(Math.random()).slice(2)
      const cs = getComputedStyle(el)
      const outline = cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0
      const shadow = cs.boxShadow && cs.boxShadow !== 'none'
      const name = (el.getAttribute('aria-label') || el.textContent || el.getAttribute('title') || el.id || '').trim().slice(0, 40)
      return { id: el.dataset.a11yId, tag: el.tagName.toLowerCase(), name, cls: String(el.className).slice(0, 40), indicator: outline || !!shadow }
    })
    if (!info) continue
    if (seen.has(info.id)) break
    seen.add(info.id)
    stops.push(info)
  }
  const unreached = await page.evaluate((ids) => {
    const set = new Set(ids)
    const sel = 'a[href], button, input, select, textarea, [tabindex], [role="button"], [role="tab"], [role="slider"]'
    return [...document.querySelectorAll(sel)]
      .filter((el) => {
        const r = el.getBoundingClientRect()
        const cs = getComputedStyle(el)
        if (r.width === 0 || r.height === 0 || cs.visibility === 'hidden') return false
        if (el.disabled || el.getAttribute('aria-disabled') === 'true' || el.getAttribute('tabindex') === '-1') return false
        if (el.type === 'hidden' || el.closest('[inert]')) return false
        return !set.has(el.dataset.a11yId)
      })
      .map((el) => `${el.tagName.toLowerCase()} "${(el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 30)}"`)
      .slice(0, 15)
  }, [...seen])
  // Tab moves through radio groups and composite widgets one stop at a time, so an
  // "unreached" sibling radio / tab is expected; listed for a manual look.
  const row = {
    page: name,
    theme,
    violations,
    incomplete: axe.incomplete.map((v) => ({ id: v.id, count: v.nodes.length, nodes: v.nodes.slice(0, 8).map((n) => `${n.target.join(" ")} :: ${(n.any[0]?.message ?? "").slice(0, 90)}`) })),
    tabStops: stops.length,
    stops: stops.map((s) => `${s.tag} "${s.name}"`),
    noIndicator: stops.filter((s) => !s.indicator).map((s) => `${s.tag}.${s.cls} "${s.name}"`),
    unreached,
  }
  report.push(row)
  const sev = violations.map((v) => `${v.impact}:${v.id}(${v.count})`).join(' ') || 'none'
  console.log(`${name.padEnd(10)} ${theme.padEnd(5)} axe: ${sev} | tab stops ${stops.length}, no focus ring ${row.noIndicator.length}, unreached ${unreached.length}`)
}

try {
  for (const theme of themes) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    await ctx.addInitScript((t) => localStorage.setItem('dpa-theme', t), theme)
    const page = await ctx.newPage()
    await page.goto(base + '#/signin')
    await page.locator('#si-email').waitFor()
    await audit(page, 'signin', theme)

    await page.fill('#si-email', env.TEST_ACCOUNT_EMAIL)
    await page.fill('#si-pw', env.TEST_ACCOUNT_PASSWORD)
    await page.locator('button[type="submit"]').click()
    await page.locator('main.v2-main').waitFor({ timeout: 30_000 })
    for (const name of pages) {
      await page.goto(base + PAGES[name])
      await page.locator('main.v2-main').waitFor()
      await audit(page, name, theme)
    }
    await ctx.close()
  }
  const out = opt('--json')
  if (out) writeFileSync(out, JSON.stringify(report, null, 2))
} finally {
  await browser.close()
  await server.close()
}
