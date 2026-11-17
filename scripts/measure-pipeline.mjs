// Timing and size of the on-device pipeline (NFR-6, NFR-7, NFR-10) on the SYNTHETIC
// test clips only (public/clips, made by `npm run clips`; no person, no real footage).
//
//   node scripts/measure-pipeline.mjs [--clips 1014-1,7310-1,4850-0] [--cpu]
//
// Headless Chrome (Playwright, installed Chrome) loads the app's own modules from a Vite
// dev server and runs the same steps as src/v2/pipeline.ts on one clip at a time:
// estimatePose → smoothSeries → encodeSeries (gzip) → computeMetrics. Nothing is uploaded.
// --cpu times a CPU-delegate landmarker over the first 10 s of each clip instead.
// Output: one JSON line per clip on stdout and a markdown table at the end.

import { existsSync } from 'node:fs'
import { createServer } from 'vite'
import { chromium } from '@playwright/test'

const args = process.argv.slice(2)
const opt = (name) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}
const forceCpu = args.includes('--cpu')

const server = await createServer({
  server: { port: 5198, strictPort: false },
  logLevel: 'error',
  // Never touch the real Supabase project from a measurement run.
  define: { 'import.meta.env.VITE_SUPABASE_URL': '""', 'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY': '""' },
})
await server.listen()
const url = server.resolvedUrls.local[0]

const { CLIP_TRACKS } = await server.ssrLoadModule('/src/mock/clips.ts')
const known = CLIP_TRACKS.map((c) => `${c.seed}-${c.variation}`)
const wanted = opt('--clips')?.split(',') ?? known.slice(0, 3)
for (const c of wanted) if (!known.includes(c)) throw new Error(`${c} is not a synthetic test clip (${known.join(', ')}).`)
for (const c of wanted) if (!existsSync(`public/clips/${c}.mp4`)) throw new Error(`public/clips/${c}.mp4 is missing: run npm run clips.`)

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11'],
})
const results = []
try {
  const version = browser.version()
  if (forceCpu) {
    // The app only falls back to CPU when GPU creation fails, and hiding WebGL breaks the
    // CPU path too (MediaPipe still needs a GL context for image input). So build a CPU
    // landmarker here with the app's own fileset and frame plan, over the first 10 s.
    for (const clip of wanted) {
      const page = await browser.newPage()
      await page.route('**/__measure.html', (r) =>
        r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><meta charset="utf-8"><title>measure</title><body></body>' }),
      )
      await page.goto(url + '__measure.html')
      const row = await page.evaluate(async (src) => {
        const { PoseLandmarker } = await import('/node_modules/@mediapipe/tasks-vision/vision_bundle.mjs')
        const { WASM_FILESET, MODEL_URL_LOCAL } = await import('/src/pose/landmarker.ts')
        const { planFrames } = await import('/src/pose/frames.ts')
        const t0 = performance.now()
        const modelAssetBuffer = new Uint8Array(await (await fetch(MODEL_URL_LOCAL)).arrayBuffer())
        const lm = await PoseLandmarker.createFromOptions(WASM_FILESET, {
          baseOptions: { modelAssetBuffer, delegate: 'CPU' },
          runningMode: 'VIDEO',
          numPoses: 1,
        })
        const t1 = performance.now()
        const v = document.createElement('video')
        v.muted = true
        v.preload = 'auto'
        await new Promise((r) => ((v.onloadeddata = r), (v.src = src)))
        const plan = planFrames(Math.min(10, v.duration))
        let detected = 0
        const t2 = performance.now()
        for (const f of plan.frames) {
          await new Promise((r) => ((v.onseeked = r), (v.currentTime = f.seekS)))
          if (lm.detectForVideo(v, f.timestampMs).worldLandmarks.length) detected++
        }
        const t3 = performance.now()
        lm.close()
        return { delegate: 'CPU', frames: plan.frames.length, detected, modelLoadMs: t1 - t0, poseMs: t3 - t2, msPerFrame: (t3 - t2) / plan.frames.length }
      }, `/clips/${clip}.mp4`)
      await page.close()
      console.log(JSON.stringify({ clip, ...row }))
    }
  }
  for (const clip of forceCpu ? [] : wanted) {
    // A fresh page per clip, so every row includes the model load (a cold start).
    const page = await browser.newPage()
    page.on('pageerror', (e) => console.error('[page]', e))
    await page.route('**/__measure.html', (r) =>
      r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><meta charset="utf-8"><title>measure</title><body></body>' }),
    )
    await page.goto(url + '__measure.html')
    const row = await page.evaluate(async (src) => {
      const { estimatePose, getLandmarker, currentDelegate } = await import('/src/pose/landmarker.ts')
      const { smoothSeries } = await import('/src/pose/oneEuro.ts')
      const { encodeSeries } = await import('/src/pose/codec.ts')
      const { computeMetrics } = await import('/src/metrics/engine.ts')
      const t0 = performance.now()
      await getLandmarker()
      const t1 = performance.now()
      const raw = await estimatePose(src)
      const t2 = performance.now()
      const series = smoothSeries(raw)
      const t3 = performance.now()
      const blob = await encodeSeries(series)
      const t4 = performance.now()
      const metrics = computeMetrics(series, 'releve_balance')
      const t5 = performance.now()
      const detected = raw.frames.filter((f) => f.world).length
      return {
        delegate: currentDelegate(),
        durationS: raw.durationS,
        width: raw.width,
        height: raw.height,
        frames: raw.frames.length,
        detected,
        modelLoadMs: t1 - t0,
        poseMs: t2 - t1,
        msPerFrame: (t2 - t1) / raw.frames.length,
        smoothMs: t3 - t2,
        encodeMs: t4 - t3,
        metricsMs: t5 - t4,
        gzipBytes: blob.size,
        jsonBytes: JSON.stringify(series).length,
        metricsComputed: Object.values(metrics.confidence).length,
      }
    }, `/clips/${clip}.mp4`)
    await page.close()
    row.clip = clip
    results.push(row)
    console.log(JSON.stringify(row))
  }

  const f = (x, d = 0) => x.toFixed(d)
  console.log(`\nChrome ${version}\n`)
  if (results.length) console.log('| Clip | Size | Duration | Frames (pose found) | Delegate | Model load | Pose | ms/frame | Pose for 10 s @ 30 fps | Smooth | Metrics | Encode | gzip keypoints | per minute |')
  if (results.length) console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |')
  for (const r of results) {
    const perMin = (r.gzipBytes / r.durationS) * 60
    console.log(
      `| ${r.clip} | ${r.width}×${r.height} | ${f(r.durationS, 1)} s | ${r.frames} (${r.detected}) | ${r.delegate} | ${f(r.modelLoadMs / 1000, 1)} s | ${f(r.poseMs / 1000, 1)} s | ${f(r.msPerFrame, 1)} | ${f((r.msPerFrame * 300) / 1000, 1)} s | ${f(r.smoothMs)} ms | ${f(r.metricsMs)} ms | ${f(r.encodeMs)} ms | ${f(r.gzipBytes / 1024)} KB | ${f(perMin / 1024)} KB |`,
    )
  }
} finally {
  await browser.close()
  await server.close()
}
