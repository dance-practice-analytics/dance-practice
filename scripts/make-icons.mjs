// Generates the app icons from the brand mark (Logo B1, arabesque; the same paths as
// Logo in src/v2/components/Icon.tsx and BrandMark in src/components/AppBar.tsx):
// public/favicon.svg and the PNGs in public/icons.
// Rendered in headless Chrome, so there is no image dependency.
//   node scripts/make-icons.mjs      (set CHROME_PATH if Chrome isn't in the default place)

import { mkdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import puppeteer from 'puppeteer-core'

const ACCENT = '#C8F54A' // electric lime tile (landing page logo)
const INK = '#0B1533' // midnight navy figure

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean)
const chrome = CHROME_CANDIDATES.find((p) => existsSync(p))
if (!chrome) throw new Error('Chrome not found. Set CHROME_PATH to a Chrome or Chromium executable.')

const MARK_FILL = 'M21.8 33.2C25.6 28.6 34.8 27.4 39.2 30.2C36.6 34.8 27.6 37.4 21.8 33.2Z'
const MARK_LINE =
  'M12.6 16.5a3.4 3.4 0 1 0 6.8 0a3.4 3.4 0 1 0 -6.8 0M19.6 20.6C23 24.5 26.2 28.2 29.6 31.2M21 22C15.5 21.8 10 20.3 5 17M22.4 22.6C29 22.5 34.5 19.5 38.5 14.5M29.8 32.2C30.6 40 30.9 48 31 56.4L31.3 60M30.8 31.6C39 31.2 48 28.2 59.5 21.8M24 60.6H37'

/**
 * radius: corner radius of the square in the 64-unit viewBox (0 = full bleed).
 * scale: figure size around the centre; maskable icons keep it inside the safe zone
 * (the central circle with 80% of the width), which launchers may crop to.
 * stroke: line weight in grid units; heavier for the sizes that are shown small.
 */
const svg = ({ radius, scale, stroke }) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">` +
  `<rect width="64" height="64" rx="${radius}" fill="${ACCENT}"/>` +
  `<g transform="translate(32 32) scale(${scale}) translate(-32 -32)">` +
  `<path d="${MARK_FILL}" fill="${INK}"/>` +
  `<path d="${MARK_LINE}" fill="none" stroke="${INK}" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round"/>` +
  `</g></svg>
`

// Sizes and weights follow the logo sheet: app icon 78% / 2.7, circle-masked 66% / 3.3, favicon 92% / 4.6.
const PNGS = [
  { file: 'icon-192.png', size: 192, radius: 14.4, scale: 0.78, stroke: 2.7 },
  { file: 'icon-512.png', size: 512, radius: 14.4, scale: 0.78, stroke: 2.7 },
  { file: 'icon-maskable-512.png', size: 512, radius: 0, scale: 0.66, stroke: 3.3 },
  // iOS rounds the corners itself and shows transparency as black, so this one is opaque.
  { file: 'apple-touch-icon.png', size: 180, radius: 0, scale: 0.78, stroke: 2.7 },
]

await mkdir('public/icons', { recursive: true })
await writeFile('public/favicon.svg', svg({ radius: 16, scale: 0.92, stroke: 4.6 }))
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
