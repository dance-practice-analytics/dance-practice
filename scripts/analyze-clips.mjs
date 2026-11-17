// Batch analysis of local clips with the app's own on-device pipeline, for the
// measurement-accuracy study. Nothing is uploaded: the clips are read from disk into
// headless Chrome as blob URLs (like the app does), Supabase is blanked, and results are
// written only to the --out folder, which must be OUTSIDE the repository.
//
//   node scripts/analyze-clips.mjs --dir <folder with clips> --out <results folder> [--movement releve_balance|phrase]
//
// Per clip: <name>.series.json.gz (smoothed keypoints, as the app stores them) and
// <name>.result.json (metrics for relevé and pirouette, phases, tracking quality).
// Also results.csv with one row per clip. Never prints or stores frames.
//
// --movement phrase also writes <name>.phrase.json (the app's phrase result: events and
// theme measures, src/metrics/phrase.ts) and phrase.csv. A clip whose series was already
// stored by an earlier run is not processed again: its phrase result is computed from the
// stored series in Node, so `--dir` may then be the results folder itself (no video needed).

import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { createServer } from 'vite'
import { chromium } from '@playwright/test'

const args = process.argv.slice(2)
const opt = (n, d) => {
  const i = args.indexOf(n)
  return i >= 0 ? args[i + 1] : d
}
const dir = opt('--dir')
const out = opt('--out')
const only = opt('--only')
const movement = opt('--movement', 'releve_balance')
if (!['releve_balance', 'pirouette', 'phrase'].includes(movement)) throw new Error('--movement must be releve_balance, pirouette or phrase')
if (!dir || !out) throw new Error('Usage: --dir <clips> --out <results folder> [--movement phrase]')
const repo = resolve('.')
if (resolve(out).toLowerCase().startsWith(repo.toLowerCase())) throw new Error('--out must be outside the repository (NDA).')
mkdirSync(out, { recursive: true })

const clips = readdirSync(dir)
  .filter((f) => /\.(mp4|mov|m4v|webm)$/i.test(f))
  .filter((f) => !only || f.includes(only))
  .sort()
// Phrase runs also pick up series stored by earlier runs (clips not in --dir any more).
const storedSeries = movement === 'phrase'
  ? readdirSync(out).filter((f) => f.endsWith('.series.json.gz')).map((f) => f.replace('.series.json.gz', '')).filter((s) => !only || s.includes(only))
  : []

const server = await createServer({
  server: { port: 5199, strictPort: false },
  logLevel: 'error',
  define: { 'import.meta.env.VITE_SUPABASE_URL': '""', 'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY': '""' },
})
await server.listen()
const url = server.resolvedUrls.local[0]
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11'] })

const rows = []
const phraseRows = []

/** Phrase result of a stored series, computed in Node with the app's own code. */
async function phraseFromStored(stem) {
  const target = join(out, `${stem}.phrase.json`)
  if (existsSync(target)) return JSON.parse(readFileSync(target, 'utf8'))
  const { decodeSeries } = await server.ssrLoadModule('/src/pose/codec.ts')
  const { computePhrase } = await server.ssrLoadModule('/src/metrics/phrase.ts')
  const series = await decodeSeries(new Blob([readFileSync(join(out, `${stem}.series.json.gz`))]))
  const phrase = computePhrase(series)
  writeFileSync(target, JSON.stringify(phrase, null, 2))
  return phrase
}

function notePhrase(stem, phrase) {
  const m = /^([A-Z]\d{2})_att(\d+)_([a-z])/i.exec(stem)
  phraseRows.push({ clip: stem, subject: m?.[1] ?? null, attempt: m ? Number(m[2]) : null, view: m?.[3] ?? null, phrase })
  const t = phrase.themes
  console.log(
    `${stem} [phrase ${phrase.version}]: ${phrase.events.length} events, labels doubtful ${phrase.label_doubt_share ?? '–'}; ` +
      Object.entries(t).map(([k, v]) => `${k} ${v.value ?? '—'}${v.value === null ? ` (${v.confidence.reason})` : ` ${v.confidence.level}`}`).join(', '),
  )
}

try {
  for (const name of clips) {
    const stem = name.replace(/\.[^.]+$/, '')
    if (existsSync(join(out, `${stem}.result.json`))) {
      rows.push(JSON.parse(readFileSync(join(out, `${stem}.result.json`), 'utf8')))
      console.log(`skip ${stem} (done)`)
      continue
    }
    if (movement === 'phrase' && existsSync(join(out, `${stem}.series.json.gz`))) {
      console.log(`skip pose for ${stem} (series stored)`)
      continue
    }
    const page = await browser.newPage()
    try {
    page.on('pageerror', (e) => console.error('[page]', String(e).slice(0, 200)))
    await page.route('**/__study.html', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><meta charset="utf-8"><body></body>' }))
    await page.route('**/__clip', (r) => r.fulfill({ status: 200, contentType: 'video/mp4', body: readFileSync(join(dir, name)) }))
    await page.goto(url + '__study.html')
    const t0 = Date.now()
    const evaluation = page.evaluate(async (movement) => {
      const blob = await (await fetch('/__clip')).blob()
      const src = URL.createObjectURL(blob)
      const { estimatePose, currentDelegate } = await import('/src/pose/landmarker.ts')
      const { smoothSeries } = await import('/src/pose/oneEuro.ts')
      const { encodeSeries } = await import('/src/pose/codec.ts')
      const { computeMetrics } = await import('/src/metrics/engine.ts')
      const { computeAttempt } = await import('/src/metrics/attempt.ts')
      const { segmentPhases } = await import('/src/metrics/phases.ts')
      const raw = await estimatePose(src)
      const series = smoothSeries(raw)
      const gz = new Uint8Array(await (await encodeSeries(series)).arrayBuffer())
      const releve = computeMetrics(series, 'releve_balance')
      const pirouette = computeMetrics(series, 'pirouette')
      const seg = segmentPhases(series, 'releve_balance')
      const vis = series.frames.filter((f) => f.image).map((f) => f.image.reduce((s, l) => s + (l.visibility ?? 0), 0) / f.image.length)
      return {
        delegate: currentDelegate(),
        durationS: raw.durationS,
        fps: raw.fps,
        width: raw.width,
        height: raw.height,
        frames: raw.frames.length,
        tracked: series.frames.filter((f) => f.image).length,
        meanVisibility: vis.length ? vis.reduce((a, b) => a + b, 0) / vis.length : null,
        relabeled: series.relabeled ?? null,
        segment: { support: seg.support, legLength: seg.legLength, reason: seg.reason ?? null, lifts: seg.lifts },
        releve,
        pirouette: { turn_count: pirouette.turn_count, confidence: pirouette.confidence.turn_count, phases: pirouette.phases },
        gz: Array.from(gz),
        // The pipeline's own entry point, as the app stores it for this movement.
        phrase: movement === 'phrase' ? computeAttempt(series, 'phrase').phrase : null,
      }
    }, movement)
    let timer
    const res = await Promise.race([
      evaluation,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timed out after 20 min')), 20 * 60_000) }),
    ]).finally(() => clearTimeout(timer))
    await page.close()
    writeFileSync(join(out, `${stem}.series.json.gz`), Buffer.from(res.gz))
    delete res.gz
    if (res.phrase) writeFileSync(join(out, `${stem}.phrase.json`), JSON.stringify(res.phrase, null, 2))
    delete res.phrase
    const m = /^([A-Z]\d{2})_att(\d+)_([a-z])/i.exec(stem)
    const row = { clip: stem, subject: m?.[1] ?? null, attempt: m ? Number(m[2]) : null, view: m?.[3] ?? null, seconds: (Date.now() - t0) / 1000, ...res }
    writeFileSync(join(out, `${stem}.result.json`), JSON.stringify(row, null, 2))
    rows.push(row)
    const r = row.releve
    console.log(
      `${stem}: ${row.tracked}/${row.frames} tracked, vis ${row.meanVisibility?.toFixed(2)}, support ${row.segment.support}, ` +
        `trunk ${r.trunk_inclination_deg?.toFixed(1)} pelvis ${r.pelvis_ankle_offset_norm?.toFixed(3)} balance ${r.balance_duration_s?.toFixed(2)} ` +
        `knee ${r.knee_tracking_dev_deg?.toFixed(1)} turns ${row.pirouette.turn_count} (${row.seconds.toFixed(0)} s)`,
    )
    } catch (e) {
      // One bad clip must not stop the batch; it is retried on the next run.
      const msg = String(e?.message ?? e).split('\n')[0].slice(0, 300)
      console.error(`FAILED ${stem}: ${msg}`)
      appendFileSync(join(out, 'failures.txt'), `${new Date().toISOString()}\t${stem}\t${msg}\n`)
      await page.close().catch(() => {})
    }
  }
  if (movement === 'phrase') {
    for (const stem of [...new Set([...clips.map((n) => n.replace(/\.[^.]+$/, '')), ...storedSeries])].sort()) {
      if (!existsSync(join(out, `${stem}.series.json.gz`))) continue
      notePhrase(stem, await phraseFromStored(stem))
    }
  }
} finally {
  await browser.close()
  await server.close()
}

if (movement === 'phrase') {
  const themes = ['knee_over_toes', 'head_lead', 'neck_range', 'upper_body_curve', 'arm_reach', 'circle_completion']
  const head = ['clip', 'subject', 'attempt', 'view', 'version', 'events', 'label_doubt_share', 'anchor', ...themes.flatMap((k) => [k, `${k}_conf`])]
  const lines = [head.join(',')]
  for (const r of phraseRows) {
    const p = r.phrase
    const a = p.anchor === null ? '' : p.events[p.anchor]
    lines.push([
      r.clip, r.subject, r.attempt, r.view, p.version, p.events.length, p.label_doubt_share ?? '',
      a ? `"${a.side ?? ''} ${a.values.direction ?? ''} ${a.values.peak_elevation_deg ?? ''} @${a.peak}"` : '',
      ...themes.flatMap((k) => [p.themes[k].value ?? '', p.themes[k].confidence.level + (p.themes[k].confidence.reason ? ':' + p.themes[k].confidence.reason : '')]),
    ].join(','))
  }
  writeFileSync(join(out, 'phrase.csv'), lines.join('\n'))
  console.log(`\n${phraseRows.length} phrase results → ${join(out, 'phrase.csv')}`)
}

const keys = ['trunk_inclination_deg', 'pelvis_ankle_offset_norm', 'balance_duration_s', 'knee_tracking_dev_deg']
const head = ['clip', 'subject', 'attempt', 'view', 'duration_s', 'fps', 'frames', 'tracked', 'mean_visibility', 'support', 'segment_reason',
  ...keys.flatMap((k) => [k, `${k}_conf`]), 'turn_count', 'turn_conf', 'phases']
const csv = [head.join(',')]
for (const r of rows) {
  const c = r.releve.confidence
  csv.push([
    r.clip, r.subject, r.attempt, r.view, r.durationS?.toFixed(2), r.fps, r.frames, r.tracked, r.meanVisibility?.toFixed(3), r.segment.support, r.segment.reason ?? '',
    ...keys.flatMap((k) => [r.releve[k] ?? '', (c[k]?.level ?? '') + (c[k]?.reason ? ':' + c[k].reason : '')]),
    r.pirouette.turn_count ?? '', r.pirouette.confidence?.level ?? '',
    '"' + r.releve.phases.map((p) => `${p.phase}:${p.start.toFixed(2)}-${p.end.toFixed(2)}`).join(' ') + '"',
  ].join(','))
}
// A phrase-only run over stored series has no rows: never overwrite an earlier results.csv with an empty one.
if (rows.length) {
  writeFileSync(join(out, 'results.csv'), csv.join('\n'))
  console.log(`\n${rows.length} clips → ${join(out, 'results.csv')}`)
}
