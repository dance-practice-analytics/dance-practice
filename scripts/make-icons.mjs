// Generates the app icons from the brand mark (the same glyph as BrandMark in
// src/components/AppBar.tsx): public/favicon.svg and the PNGs in public/icons.
// Rendered in headless Chrome, so there is no image dependency.
//   node scripts/make-icons.mjs      (set CHROME_PATH if Chrome isn't in the default place)

import { mkdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import puppeteer from 'puppeteer-core'

const ACCENT = '#3B57A3'
const INK = '#FFFFFF'

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean)
const chrome = CHROME_CANDIDATES.find((p) => existsSync(p))
if (!chrome) throw new Error('Chrome not found. Set CHROME_PATH to a Chrome or Chromium executable.')

/**
 * radius: corner radius of the square in the 32-unit viewBox (0 = full bleed).
 * scale: glyph size around the centre; maskable icons keep it inside the safe zone
 * (the central circle with 80% of the width), which launchers may crop to.
 */
const svg = ({ radius, scale = 1 }) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">` +
  `<rect width="32" height="32" rx="${radius}" fill="${ACCENT}"/>` +
  `<g fill="none" stroke="${INK}" stroke-width="2.4" stroke-linecap="round"` +
  (scale === 1 ? '' : ` transform="translate(16 16) scale(${scale}) translate(-16 -16)"`) +
  `><circle cx="16" cy="7.5" r="2.6" fill="${INK}" stroke="none"/>` +
  `<path d="M16 11v9M10 8.5l6 3 6-3M16 20l-3.5 7M16 20l3.5 7"/></g></svg>\n`

const PNGS = [
  { file: 'icon-192.png', size: 192, radius: 8 },
  { file: 'icon-512.png', size: 512, radius: 8 },
  { file: 'icon-maskable-512.png', size: 512, radius: 0, scale: 0.7 },
  // iOS rounds the corners itself and shows transparency as black, so this one is opaque.
  { file: 'apple-touch-icon.png', size: 180, radius: 0, scale: 0.82 },
]

await mkdir('public/icons', { recursive: true })
await writeFile('public/favicon.svg', svg({ radius: 8 }))
console.log('public/favicon.svg')

const browser = await puppeteer.launch({ executablePath: chrome, headless: true })
try {
  const page = await browser.newPage()
  for (const { file, size, ...shape } of PNGS) {
    await page.setViewport({ width: size, height: size, deviceScaleFactor: 1 })
    await page.setContent(
      `<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg(shape)}`,
    )
    const png = await page.screenshot({ type: 'png', omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } })
    await writeFile(`public/icons/${file}`, png)
    console.log(`public/icons/${file}  ${size}x${size}  ${(png.length / 1024).toFixed(1)} KB`)
  }
} finally {
  await browser.close()
}
