// Generates the synthetic test clips in public/clips by rendering each pose track
// in headless Chrome (src/mock/encodeClip.ts) and saving the MP4s.
//   npm run clips            (set CHROME_PATH if Chrome isn't in the default place)

import { mkdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { createServer } from 'vite'
import puppeteer from 'puppeteer-core'

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean)
const chrome = CHROME_CANDIDATES.find((p) => existsSync(p))
if (!chrome) throw new Error('Chrome not found. Set CHROME_PATH to a Chrome or Chromium executable.')

const server = await createServer({ server: { port: 5199, strictPort: false }, logLevel: 'error' })
await server.listen()
const url = server.resolvedUrls.local[0]
const browser = await puppeteer.launch({ executablePath: chrome, headless: true })

try {
  const page = await browser.newPage()
  page.on('pageerror', (e) => console.error(e))
  await page.goto(url)
  const tracks = await page.evaluate(async () => (await import('/src/mock/clips.ts')).CLIP_TRACKS)
  await mkdir('public/clips', { recursive: true })
  for (const { seed, variation } of tracks) {
    const started = Date.now()
    const base64 = await page.evaluate(async (seed, variation) => {
      const { encodeClip } = await import('/src/mock/encodeClip.ts')
      const bytes = await encodeClip(seed, variation)
      let s = ''
      for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
      return btoa(s)
    }, seed, variation)
    const file = `public/clips/${seed}-${variation}.mp4`
    const buf = Buffer.from(base64, 'base64')
    await writeFile(file, buf)
    console.log(`${file}  ${(buf.length / 1024).toFixed(0)} KB  ${((Date.now() - started) / 1000).toFixed(1)} s`)
  }
} finally {
  await browser.close()
  await server.close()
}
