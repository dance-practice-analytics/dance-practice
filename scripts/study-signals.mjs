// Measurement study of stored pose series (numbers only: no frames, no video).
// Decodes every <clip>.series.json.gz in a folder, runs the phrase prototypes
// (src/metrics/events.ts, src/metrics/expressive.ts) and prints, per clip, the event
// timeline and the descriptive measures, then compares clips: attempts are aligned on an
// anchor event so their structure can be compared, and views of the same attempt are put
// side by side. Optionally writes everything as JSON next to the data (never into the repo).
//
//   node scripts/study-signals.mjs <folder> [--json] [--all-events]
//
// Clip names are expected as <code>_att<N>_<view> (view f/s/d); participants by code only.

import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createServer } from 'vite'

const args = process.argv.slice(2)
const dir = args.find((a) => !a.startsWith('--'))
if (!dir) {
  console.error('usage: node scripts/study-signals.mjs <folder> [--json] [--all-events]')
  process.exit(1)
}
if (resolve(dir).startsWith(resolve('.'))) {
  console.error('Refusing to read study data from inside the repository.')
  process.exit(1)
}
const ALL = args.includes('--all-events')

const server = await createServer({ logLevel: 'error', server: { middlewareMode: true } })
const fmt = (v, d = 2) => (v === null || v === undefined ? '–' : typeof v === 'number' ? v.toFixed(d) : String(v))
const med = (a) => {
  const s = a.filter((x) => x !== null && Number.isFinite(x)).sort((x, y) => x - y)
  if (!s.length) return null
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

try {
  const { decodeSeries } = await server.ssrLoadModule('/src/pose/codec.ts')
  const E = await server.ssrLoadModule('/src/metrics/events.ts')
  const X = await server.ssrLoadModule('/src/metrics/expressive.ts')

  const clips = []
  for (const file of readdirSync(dir).filter((x) => x.endsWith('.series.json.gz')).sort()) {
    const name = file.replace('.series.json.gz', '')
    const m = /_att(\d+)_([fsd])$/.exec(name)
    const series = await decodeSeries(new Blob([readFileSync(join(dir, file))]))
    const sig = E.bodySignals(series)
    const sum = X.expressiveSummary(series)
    const labelDoubt = sig.labelDoubt.filter((x) => x !== null)
    // Image knee offset over the plié frames (meaningful in the front view only).
    const aspect = series.width / series.height
    const imgKnee = { left: [], right: [] }
    for (const e of sum.events.filter((x) => x.kind === 'plie'))
      for (let i = e.i0; i < e.i1; i++)
        for (const s of ['left', 'right']) {
          const im = series.frames[i].image
          const v = im ? X.imageKneeOffset(im, s, aspect) : null
          if (v !== null) imgKnee[s].push(v)
        }
    clips.push({
      name,
      attempt: m ? Number(m[1]) : null,
      view: m ? m[2] : null,
      durationS: series.durationS,
      leg: sig.leg,
      labelDoubtShare: labelDoubt.length ? labelDoubt.filter(Boolean).length / labelDoubt.length : null,
      sum,
      imgKnee: { left: med(imgKnee.left), right: med(imgKnee.right) },
    })
  }

  // ---------- per clip ----------
  const short = (e) => {
    const v = e.values
    switch (e.kind) {
      case 'gesture':
        return `${v.side} leg ${v.direction ?? '?'} ${fmt(v.peak_elevation_deg, 0)}° knee ${fmt(v.working_knee_deg, 0)}° (${v.level}) trunk ${fmt(v.trunk_deg, 0)}° held ${fmt(v.held_s)} s, supp heel ${fmt(v.supporting_heel_lift_L)} L, hip hike ${fmt(v.working_hip_above_L)} L`
      case 'releve':
        return `relevé heel ${fmt(v.median_heel_lift_L)} L for ${fmt(v.duration_s)} s, trunk ${fmt(v.trunk_deg, 0)}°`
      case 'plie':
        return `plié knees ${fmt(v.peak_knee_deg, 0)}°, trunk ${fmt(v.trunk_at_peak_deg, 0)}°`
      case 'tilt':
        return `trunk ${v.direction ?? '?'} ${fmt(v.peak_deg, 0)}° (knees ${fmt(v.knees_at_peak_deg, 0)}°) ${fmt(v.duration_s)} s`
      case 'turn':
        return `turn ${fmt(v.degrees, 0)}° ${v.direction} in ${fmt(v.duration_s)} s`
    }
  }
  const major = (e) =>
    (e.kind === 'gesture' && e.values.peak_elevation_deg >= 45) ||
    (e.kind === 'tilt' && e.values.peak_deg >= 55) ||
    (e.kind === 'turn' && e.values.degrees >= 200) ||
    e.kind === 'releve'

  for (const c of clips) {
    console.log(`\n=== ${c.name}  ${c.durationS.toFixed(2)} s  leg ${fmt(c.leg, 3)} m  feet-point-back ${fmt(c.labelDoubtShare * 100, 1)}% of frames`)
    for (const e of c.sum.events) if (ALL || major(e)) console.log(`  ${fmt(e.start).padStart(6)}–${fmt(e.end).padEnd(6)} ${e.kind.padEnd(8)} ${short(e)}`)
    const k = c.sum.knee
    const kp = (kind, s) => med(k.filter((x) => x.kind === kind && x.side === s).map((x) => x.medianDeg))
    console.log(
      `  knee (signed, +inside): plié L ${fmt(kp('plie', 'left'), 1)}° R ${fmt(kp('plie', 'right'), 1)}°; single-leg support L ${fmt(kp('single_leg', 'left'), 1)}° R ${fmt(kp('single_leg', 'right'), 1)}°; image offset in pliés L ${fmt(c.imgKnee.left)} R ${fmt(c.imgKnee.right)} shin`,
    )
    const l = c.sum.lead
    console.log(
      `  head lead: ${l?.pairs.length ?? 0} paired onsets (arm ${l?.armOnsets}, head ${l?.headOnsets}), median arm−head ${fmt(l?.medianLatencyS)} s, head first ${fmt(l?.headFirstShare)}, xcorr lag ${fmt(l?.xcorrLagS)} s`,
    )
    const h = c.sum.head
    console.log(
      `  head/neck: range ${fmt(h?.neckRangeDeg, 0)}°, speed med ${fmt(h?.neckSpeedMedian, 0)} p90 ${fmt(h?.neckSpeedP90, 0)} °/s, peaks ${fmt(h?.headPeaksPerS)}/s, jerk RMS ${fmt(h?.headJerkRms, 0)} L/s³`,
    )
    console.log(`  head–trunk curve: p95 ${fmt(c.sum.curve.p95Deg, 0)}° p5 ${fmt(c.sum.curve.p5Deg, 0)}°, image p95 ${fmt(c.sum.curve.imageP95Deg, 0)}°`)
    const r = c.sum.reach
    console.log(
      `  reach: L p90 ${fmt(r.left.reachP90)} peak ${fmt(r.left.reachPeak)} extended ${fmt(r.left.extendedS)} s (longest ${fmt(r.left.longestExtendedS)}); R p90 ${fmt(r.right.reachP90)} peak ${fmt(r.right.reachPeak)} extended ${fmt(r.right.extendedS)} s (longest ${fmt(r.right.longestExtendedS)})`,
    )
    console.log(`  circles: ${c.sum.circles.map((x) => `${x.limb} ${x.plane} ${x.sweptDeg}° closure ${fmt(x.closure)} @${fmt(x.start, 1)}`).join('; ') || 'none'}`)
  }

  // ---------- alignment across attempts and views ----------
  // Anchor: the first right-leg gesture at or above 75° elevation (present in every clip of D01).
  const anchorOf = (c) => c.sum.events.find((e) => e.kind === 'gesture' && e.values.side === 'right' && e.values.peak_elevation_deg >= 75)
  console.log('\n=== Sequence of major events, times relative to the anchor (first right-leg gesture ≥ 75°)')
  for (const c of clips) {
    const a = anchorOf(c)
    if (!a) {
      console.log(`${c.name}: no anchor`)
      continue
    }
    const seq = c.sum.events.filter(major).map((e) => {
      const dt = (e.start - a.start).toFixed(1)
      const v = e.values
      const tag =
        e.kind === 'gesture'
          ? `${v.side[0].toUpperCase()}${v.direction ? ':' + v.direction : ''}${Math.round(v.peak_elevation_deg)}`
          : e.kind === 'tilt'
            ? `T${v.direction?.[0] ?? '?'}${Math.round(v.peak_deg)}`
            : e.kind === 'turn'
              ? `turn${Math.round(v.degrees)}`
              : 'RLV'
      return `${dt}:${tag}`
    })
    console.log(`${c.name.padEnd(11)} anchor@${a.start.toFixed(2)}  ${seq.join(' ')}`)
  }

  // ---------- views of one attempt ----------
  console.log('\n=== Same event across views (anchor gesture, and the last left-leg gesture ≥ 75°)')
  for (const att of [...new Set(clips.map((c) => c.attempt))]) {
    for (const c of clips.filter((x) => x.attempt === att)) {
      const a = anchorOf(c)
      const last = [...c.sum.events].reverse().find((e) => e.kind === 'gesture' && e.values.side === 'left' && e.values.peak_elevation_deg >= 75)
      const g = (e) => (e ? `${fmt(e.values.peak_elevation_deg, 0)}° ${e.values.direction} knee ${fmt(e.values.working_knee_deg, 0)}° trunk ${fmt(e.values.trunk_deg, 0)}° held ${fmt(e.values.held_s)}s` : '–')
      console.log(`att${att} ${c.view}: anchor R ${g(a)} | last L ${g(last)}`)
    }
  }

  if (args.includes('--json')) {
    const out = join(dir, 'study-signals.json')
    writeFileSync(out, JSON.stringify(clips.map(({ sum, ...rest }) => ({ ...rest, ...sum })), null, 1))
    console.log(`\nwrote ${out}`)
  }
} finally {
  await server.close()
}
