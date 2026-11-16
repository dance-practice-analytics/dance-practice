// End-to-end calibration of the metrics engine on the SYNTHETIC test clips only
// (public/clips, made by `npm run clips`; no person, no real footage).
//
//   node scripts/calibrate-metrics.mjs [--cache DIR] [--clips 1014-1,7310-1] [--refresh] [--seek-check]
//
// 1. Headless Chrome runs the app's own pose step (src/pose/landmarker.ts, MediaPipe
//    Pose Landmarker full) over each clip and the raw PoseSeries is cached as JSON in
//    DIR (default: <os tmp>/dance-practice-calibration). --refresh re-runs MediaPipe.
// 2. Node (through Vite's SSR loader, so it is the current source) smooths, slices each
//    clip into its four attempts and runs computeMetrics, then compares every value with
//    the truth drawn into the clip (src/metrics/testing/clipTruth.ts).
// 3. --seek-check also counts, with requestVideoFrameCallback, which frame Chrome shows
//    for every planned seek (planFrames) against the old mid-frame target.
// Output: a markdown report on stdout and DIR/calibration-results.json.
//
// Refuses any clip that is not one of the generated synthetic tracks.

import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'vite'
import puppeteer from 'puppeteer-core'

const args = process.argv.slice(2)
const opt = (name) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}
const cacheDir = opt('--cache') ?? join(tmpdir(), 'dance-practice-calibration')
const refresh = args.includes('--refresh')
const seekCheck = args.includes('--seek-check')

const server = await createServer({ server: { port: 5197, strictPort: false }, logLevel: 'error' })
await server.listen()
const url = server.resolvedUrls.local[0]

const { CLIP_TRACKS } = await server.ssrLoadModule('/src/mock/clips.ts')
const known = CLIP_TRACKS.map((c) => `${c.seed}-${c.variation}`)
const wanted = opt('--clips')?.split(',') ?? known
for (const c of wanted) if (!known.includes(c)) throw new Error(`${c} is not a synthetic test clip (${known.join(', ')}).`)
for (const c of wanted) if (!existsSync(`public/clips/${c}.mp4`)) throw new Error(`public/clips/${c}.mp4 is missing: run npm run clips.`)
await mkdir(cacheDir, { recursive: true })

let browser = null
async function page() {
  if (!browser) {
    const chrome = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].find((p) => p && existsSync(p))
    if (!chrome) throw new Error('Chrome not found. Set CHROME_PATH.')
    browser = await puppeteer.launch({ executablePath: chrome, headless: true, protocolTimeout: 1_800_000 })
  }
  const p = await browser.newPage()
  p.on('pageerror', (e) => console.error('[page]', e))
  await p.setRequestInterception(true)
  p.on('request', (r) =>
    r.url().endsWith('/__calibrate.html')
      ? r.respond({ status: 200, contentType: 'text/html', body: '<!doctype html><meta charset="utf-8"><title>calibrate</title><body></body>' })
      : r.continue(),
  )
  await p.goto(url + '__calibrate.html')
  return p
}

try {
  const report = { clips: {}, seek: null }
  for (const clip of wanted) {
    const file = join(cacheDir, `${clip}.raw.json`)
    if (refresh || !existsSync(file)) {
      const started = Date.now()
      const p = await page()
      const raw = await p.evaluate(async (src) => {
        const { estimatePose, currentDelegate } = await import('/src/pose/landmarker.ts')
        const series = await estimatePose(src)
        return { series, delegate: currentDelegate() }
      }, `/clips/${clip}.mp4`)
      await p.close()
      await writeFile(file, JSON.stringify(raw))
      console.error(`${clip}: MediaPipe (${raw.delegate}) ${raw.series.frames.length} frames in ${((Date.now() - started) / 1000).toFixed(0)} s`)
    }
  }

  if (seekCheck) {
    const p = await page()
    report.seek = await p.evaluate(async (src) => {
      const { planFrames } = await import('/src/pose/frames.ts')
      const v = document.createElement('video')
      v.muted = true
      v.preload = 'auto'
      v.style.width = '54px'
      document.body.appendChild(v) // requestVideoFrameCallback needs a rendered video
      await new Promise((r) => {
        v.onloadeddata = r
        v.src = src
      })
      const shown = (t) =>
        new Promise((resolve) => {
          let meta = null
          let seeked = false
          const done = () => meta && seeked && resolve(meta.mediaTime)
          v.requestVideoFrameCallback((_, m) => {
            meta = m
            done()
          })
          v.addEventListener('seeked', () => ((seeked = true), done()), { once: true })
          v.currentTime = t
          setTimeout(() => resolve(meta ? meta.mediaTime : NaN), 3000)
        })
      const plan = planFrames(v.duration)
      const out = {}
      for (const [name, target] of [
        ['planFrames', (f) => f.seekS],
        ['mid-frame (until 1.1.0)', (f) => f.t + 0.5 / plan.fps],
      ]) {
        await shown(5.01)
        let wrong = 0
        for (const [i, f] of plan.frames.entries()) {
          const mt = await shown(target(f))
          if (!(Math.abs(mt * plan.fps - i) < 0.01)) wrong++
        }
        out[name] = { wrong, of: plan.frames.length }
      }
      return out
    }, `/clips/${wanted[0]}.mp4`)
    await p.close()
  }

  const { evaluateClip } = await server.ssrLoadModule('/src/metrics/testing/endToEnd.ts')
  const { ALGORITHM_VERSION } = await server.ssrLoadModule('/src/metrics/engine.ts')
  const rows = []
  for (const clip of wanted) {
    const { series } = JSON.parse(await readFile(join(cacheDir, `${clip}.raw.json`), 'utf8'))
    const [seed, variation] = clip.split('-').map(Number)
    rows.push(...evaluateClip(series, seed, variation))
  }
  report.clips = rows

  // ---------- markdown ----------
  const f = (x, d = 3) => (x === null || x === undefined || Number.isNaN(x) ? '–' : x.toFixed(d))
  const pct = (x) => (x === null ? '–' : `${x >= 0 ? '+' : ''}${(x * 100).toFixed(0)}%`)
  const out = []
  out.push(`Engine ${ALGORITHM_VERSION}; ${rows.length} attempts from ${wanted.length} synthetic clips (${wanted.join(', ')}).`)
  if (report.seek) {
    out.push('', 'Frame seek (requestVideoFrameCallback, frames shown off target):')
    for (const [k, v] of Object.entries(report.seek)) out.push(`- ${k}: ${v.wrong} of ${v.of}`)
  }
  out.push('', '| clip | att | side | trunk true | trunk meas | pelvis true | pelvis meas | balance true | balance meas | onset Δ | hold Δ | end Δ | trunk side err (standing) | trunk \|depth\| | pelvis L x/xz | pelvis R x/xz | hold speed xz/x/z m/s (share ≥0.15 xz/x) | knee flex max (3D true) |')
  out.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|')
  const d = (a, b) => (a === null || b === null ? null : a - b)
  for (const r of rows) {
    const m = r.metrics
    out.push(
      `| ${r.clip} | ${r.attempt} | ${r.support ?? '–'} | ${f(r.truth.trunk, 2)} | ${f(m.trunk_inclination_deg, 2)} | ${f(r.truth.pelvis)} | ${f(m.pelvis_ankle_offset_norm)} | ${f(r.truth.balance, 2)} | ${f(m.balance_duration_s, 2)} | ${f(d(r.found.onset, r.truth.onset), 2)} | ${f(d(r.found.holdStart, r.truth.holdStart), 2)} | ${f(d(r.found.end, r.truth.end), 2)} | ${f(r.parts.trunkSideErr, 2)} (${f(r.parts.standingSide, 2)}) | ${f(r.parts.trunkDepthAbs, 2)} | ${f(r.parts.pelvisLeftX)}/${f(r.parts.pelvisLeftXZ)} | ${f(r.parts.pelvisRightX)}/${f(r.parts.pelvisRightXZ)} | ${f(r.parts.speedXZ, 2)}/${f(r.parts.speedX, 2)}/${f(r.parts.speedZ, 2)} (${pct(r.parts.fastXZ)}/${pct(r.parts.fastX)}) | ${f(r.parts.maxFlexion, 1)} (${f(r.truth.plieFlexion3D, 0)}) |`,
    )
  }
  const agg = (name, meas, tru, rel = false) => {
    const pairs = rows.map((r) => [meas(r), tru(r)]).filter(([a, b]) => a !== null && b !== null)
    const errs = pairs.map(([a, b]) => (rel ? (a - b) / b : a - b))
    const mean = errs.reduce((s, e) => s + e, 0) / (errs.length || 1)
    const mae = errs.reduce((s, e) => s + Math.abs(e), 0) / (errs.length || 1)
    const worst = errs.reduce((s, e) => (Math.abs(e) > Math.abs(s) ? e : s), 0)
    const nulls = rows.length - pairs.length
    return `| ${name} | ${pairs.length} | ${nulls} | ${rel ? pct(mean) : f(mean, 3)} | ${rel ? pct(mae) : f(mae, 3)} | ${rel ? pct(worst) : f(worst, 3)} |`
  }
  out.push('', '| metric | n | nulls | mean error | mean abs error | worst |', '|---|---|---|---|---|---|')
  out.push(agg('trunk inclination (deg)', (r) => r.metrics.trunk_inclination_deg, (r) => r.truth.trunk))
  out.push(agg('pelvis–ankle offset (leg lengths)', (r) => r.metrics.pelvis_ankle_offset_norm, (r) => r.truth.pelvis))
  out.push(agg('pelvis–ankle offset (relative)', (r) => r.metrics.pelvis_ankle_offset_norm, (r) => r.truth.pelvis, true))
  out.push(agg('balance duration (s)', (r) => r.metrics.balance_duration_s, (r) => r.truth.balance))
  out.push(agg('lift onset (s)', (r) => r.found.onset, (r) => r.truth.onset))
  out.push(agg('hold start (s)', (r) => r.found.holdStart, (r) => r.truth.holdStart))
  out.push(agg('lift end (s)', (r) => r.found.end, (r) => r.truth.end))
  out.push(agg('trunk sideways part (deg)', (r) => r.parts.trunkSideErr, () => 0))
  out.push(agg('trunk |depth| part (deg)', (r) => r.parts.trunkDepthAbs, () => 0))
  const knee = rows.map((r) => r.metrics.knee_tracking_dev_deg)
  out.push('', `Knee tracking: ${knee.filter((k) => k === null).length} of ${rows.length} null (${[...new Set(rows.map((r) => r.metrics.confidence.knee_tracking_dev_deg.reason ?? 'value'))].join(', ')}).`)
  out.push(`Sway in the drawn holds: max ${f(Math.max(...rows.map((r) => r.truth.maxSwaySpeed)))} leg lengths/s, max offset ${f(Math.max(...rows.map((r) => r.truth.maxOffset)))} (band: 0.15 m/s, 0.25).`)
  const text = out.join('\n')
  console.log(text)

  // --write-fixture: refresh src/metrics/fixtures/mediapipe-releve-front.json from clip 1014-1
  // (first 18 s, smoothed as the app stores it, only the 12 world landmarks the engine reads).
  if (args.includes('--write-fixture')) {
    const { smoothSeries } = await server.ssrLoadModule('/src/pose/oneEuro.ts')
    const { series } = JSON.parse(await readFile(join(cacheDir, '1014-1.raw.json'), 'utf8'))
    const smoothed = smoothSeries(series)
    const landmarks = [11, 12, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32]
    const frames = smoothed.frames.slice(0, 540)
    if (frames.some((fr) => !fr.world)) throw new Error('The fixture format has no gaps.')
    const fixture = {
      note:
        'Synthetic data only. Excerpt of the MediaPipe Pose Landmarker (full) output for the generated stick-figure test clip public/clips/1014-1.mp4 (npm run clips; no person, no real footage), sampled by planFrames and smoothed by smoothSeries as the app stores it (regenerate with node scripts/calibrate-metrics.mjs --clips 1014-1 --write-fixture). First 18 s at 30 fps: the first two of the four lifts. World landmarks only, and only the 12 the metrics engine reads.',
      fps: smoothed.fps,
      width: smoothed.width,
      height: smoothed.height,
      model: smoothed.model,
      smoothed: true,
      units: { xyz: 0.0001, visibility: 0.01, t: 0.0001 },
      layout: 'frames[i] = [x, y, z, visibility] per landmark, in the order of `landmarks`, as integers in `units`',
      landmarks,
      t: frames.map((fr) => Math.round(fr.t / 0.0001)),
      frames: frames.map((fr) => landmarks.flatMap((i) => {
        const p = fr.world[i]
        return [Math.round(p.x / 0.0001), Math.round(p.y / 0.0001), Math.round(p.z / 0.0001), Math.round(p.visibility / 0.01)]
      })),
    }
    const json = JSON.stringify(fixture, null, 1).replace(/\[\n\s+([-\d,\s]+?)\n\s+\]/g, (_, body) => `[${body.replace(/\s+/g, '')}]`)
    await writeFile('src/metrics/fixtures/mediapipe-releve-front.json', json + '\n')
    console.error('Wrote src/metrics/fixtures/mediapipe-releve-front.json')
  }
  await writeFile(join(cacheDir, 'calibration-results.json'), JSON.stringify(report, null, 1))
  await writeFile(join(cacheDir, 'calibration-report.md'), text)
} finally {
  if (browser) await browser.close()
  await server.close()
}
