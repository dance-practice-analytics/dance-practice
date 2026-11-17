// Tests whether the front/side/diagonal clips of one attempt are the same take filmed
// simultaneously by several cameras. Cross-correlates view-robust motion signals from
// stored series (output of analyze-clips.mjs) over lags of ±maxLag seconds. Numbers
// only: never reads or renders video frames.
//
//   node scripts/sync-views.mjs <dir with <clip>.series.json.gz> [maxLagS=5] [highpassS=0]
//
// highpassS > 0 removes structure slower than that (centred moving average) first.
// Windowed check: the lag is re-estimated in 6 s windows of the first clip (3 s step);
// a simultaneous recording gives the same lag in every window, different takes do not.
//
// Signals (all invariant to camera rotation, or nearly so):
//   wristSpd  mean 3D speed of both wrists (world landmarks, m/s)
//   ankleSpd  mean 3D speed of both ankles
//   knee      mean 3D knee angle (hip-knee-ankle), degrees
//   elbow     mean 3D elbow angle
//   hipY      image height of the hip midpoint (vertical in every view)
// For each pair the Pearson r of every signal is computed at each lag (overlap >= 5 s);
// the combined curve is the mean r over signals. Sharpness = peak minus best r more than
// 1 s away from the peak. Pairs of different attempts are the control.

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { createServer } from 'vite'

const [dir, lagArg, hpArg] = process.argv.slice(2)
if (!dir) {
  console.error('usage: node scripts/sync-views.mjs <dir> [maxLagS]')
  process.exit(1)
}
const MAX_LAG_S = Number(lagArg ?? 5)
const MIN_OVERLAP_S = 5
const HP_S = Number(hpArg ?? 0)
const WIN_S = 6
const WIN_STEP_S = 3
const SIGNALS = ['wristSpd', 'ankleSpd', 'knee', 'elbow', 'hipY']

const server = await createServer({ logLevel: 'error', server: { middlewareMode: true } })
let LM, decodeSeries
try {
  ;({ decodeSeries } = await server.ssrLoadModule('/src/pose/codec.ts'))
  ;({ LM } = await server.ssrLoadModule('/src/pose/types.ts'))
  const clips = readdirSync(dir)
    .filter((f) => f.endsWith('.series.json.gz'))
    .map((f) => f.replace('.series.json.gz', ''))
    .sort()
  const data = {}
  for (const c of clips) {
    const series = await decodeSeries(new Blob([readFileSync(join(dir, `${c}.series.json.gz`))]))
    data[c] = { fps: series.fps, dur: series.durationS, sig: signals(series), view: apparentView(series) }
  }
  run(clips, data)
} finally {
  await server.close()
}

function signals(series) {
  const fps = series.fps
  const n = Math.round(series.durationS * fps) + 1
  const grid = new Array(n).fill(null)
  for (const f of series.frames) {
    const i = Math.round(f.t * fps)
    if (i >= 0 && i < n) grid[i] = f
  }
  const d3 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
  const angle = (a, b, c) => {
    const u = [a.x - b.x, a.y - b.y, a.z - b.z]
    const v = [c.x - b.x, c.y - b.y, c.z - b.z]
    const dot = u[0] * v[0] + u[1] * v[1] + u[2] * v[2]
    return (Math.acos(Math.max(-1, Math.min(1, dot / (Math.hypot(...u) * Math.hypot(...v))))) * 180) / Math.PI
  }
  const out = Object.fromEntries(SIGNALS.map((s) => [s, new Float64Array(n).fill(NaN)]))
  for (let i = 0; i < n; i++) {
    const w = grid[i]?.world
    const im = grid[i]?.image
    if (!w || !im) continue
    out.knee[i] = (angle(w[LM.leftHip], w[LM.leftKnee], w[LM.leftAnkle]) + angle(w[LM.rightHip], w[LM.rightKnee], w[LM.rightAnkle])) / 2
    out.elbow[i] = (angle(w[LM.leftShoulder], w[LM.leftElbow], w[LM.leftWrist]) + angle(w[LM.rightShoulder], w[LM.rightElbow], w[LM.rightWrist])) / 2
    out.hipY[i] = -(im[LM.leftHip].y + im[LM.rightHip].y) / 2
    const p = grid[i - 1]?.world
    if (p) {
      out.wristSpd[i] = ((d3(w[LM.leftWrist], p[LM.leftWrist]) + d3(w[LM.rightWrist], p[LM.rightWrist])) / 2) * fps
      out.ankleSpd[i] = ((d3(w[LM.leftAnkle], p[LM.leftAnkle]) + d3(w[LM.rightAnkle], p[LM.rightAnkle])) / 2) * fps
    }
  }
  // 5-frame moving average on the speeds (jitter), NaN-aware.
  for (const s of ['wristSpd', 'ankleSpd']) out[s] = movAvg(out[s], 2)
  // HIGHPASS: subtract a centred moving average so slow, choreography-level structure
  // (shared by different takes of the same exercise) does not dominate the correlation.
  if (HP_S > 0) {
    const h = Math.round((HP_S * fps) / 2)
    for (const s of SIGNALS) {
      const lo = movAvg(out[s], h)
      out[s] = out[s].map((v, i) => v - lo[i])
    }
  }
  return out
}

/** Camera angle hint from 2D proportions: image shoulder and hip width over torso
 *  length (aspect-corrected), median over tracked frames. ~0.7+ front, ~0.2 side. */
function apparentView(series) {
  const ar = series.width / series.height
  const sw = [], hw = []
  for (const f of series.frames) {
    const im = f.image
    if (!im) continue
    const ls = im[LM.leftShoulder], rs = im[LM.rightShoulder], lh = im[LM.leftHip], rh = im[LM.rightHip]
    const torso = Math.hypot(((ls.x + rs.x) / 2 - (lh.x + rh.x) / 2) * ar, (ls.y + rs.y) / 2 - (lh.y + rh.y) / 2)
    if (torso <= 0) continue
    sw.push(Math.abs(ls.x - rs.x) * ar / torso)
    hw.push(Math.abs(lh.x - rh.x) * ar / torso)
  }
  const med = (v) => { const s = [...v].sort((a, b) => a - b); return s[Math.floor(s.length / 2)] ?? NaN }
  return { shoulder: med(sw), hip: med(hw) }
}

function movAvg(a, h) {
  const r = new Float64Array(a.length).fill(NaN)
  for (let i = 0; i < a.length; i++) {
    let s = 0, k = 0
    for (let j = i - h; j <= i + h; j++) if (j >= 0 && j < a.length && !Number.isNaN(a[j])) { s += a[j]; k++ }
    if (k > h && !Number.isNaN(a[i])) r[i] = s / k
  }
  return r
}

/** Pearson r of a[i] vs b[i - lag] over valid overlapping samples. */
function pearson(a, b, lag, minN, i0 = 0, i1 = a.length) {
  let n = 0, sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0
  for (let i = Math.max(0, i0); i < Math.min(a.length, i1); i++) {
    const j = i - lag
    if (j < 0 || j >= b.length) continue
    const x = a[i], y = b[j]
    if (Number.isNaN(x) || Number.isNaN(y)) continue
    n++; sa += x; sb += y; saa += x * x; sbb += y * y; sab += x * y
  }
  if (n < minN) return NaN
  const cov = sab - (sa * sb) / n
  const va = saa - (sa * sa) / n
  const vb = sbb - (sb * sb) / n
  return va > 0 && vb > 0 ? cov / Math.sqrt(va * vb) : NaN
}

/** Lag convention: positive lag = event appears `lag` s LATER in clip A than in clip B. */
function xcorr(A, B, fps) {
  const L = Math.round(MAX_LAG_S * fps)
  const minN = MIN_OVERLAP_S * fps
  const curves = {}
  for (const s of SIGNALS) {
    curves[s] = []
    for (let lag = -L; lag <= L; lag++) curves[s].push(pearson(A.sig[s], B.sig[s], lag, minN))
  }
  const comb = []
  for (let k = 0; k <= 2 * L; k++) {
    const vals = SIGNALS.map((s) => curves[s][k]).filter((v) => !Number.isNaN(v))
    comb.push(vals.length === SIGNALS.length ? vals.reduce((x, y) => x + y, 0) / vals.length : NaN)
  }
  let best = -1, kBest = -1
  comb.forEach((v, k) => { if (v > best) { best = v; kBest = k } })
  let second = -1
  comb.forEach((v, k) => { if (Math.abs(k - kBest) > fps && v > second) second = v })
  const perSig = Object.fromEntries(SIGNALS.map((s) => {
    let b = -1, kb = -1
    curves[s].forEach((v, k) => { if (v > b) { b = v; kb = k } })
    return [s, { rAtComb: curves[s][kBest], peak: b, lagS: (kb - L) / fps }]
  }))
  return { lagS: (kBest - L) / fps, r: best, sharp: best - second, perSig }
}

/** Best combined lag in sliding windows of A; returns lags (s) of windows with r >= 0.3. */
function windowLags(A, B, fps) {
  const L = Math.round(MAX_LAG_S * fps)
  const W = Math.round(WIN_S * fps), step = Math.round(WIN_STEP_S * fps)
  const n = A.sig[SIGNALS[0]].length
  const out = []
  for (let i0 = 0; i0 + W <= n; i0 += step) {
    let best = -1, lagBest = NaN
    for (let lag = -L; lag <= L; lag++) {
      const rs = SIGNALS.map((s) => pearson(A.sig[s], B.sig[s], lag, Math.round(W * 0.7), i0, i0 + W))
      if (rs.some(Number.isNaN)) continue
      const r = rs.reduce((x, y) => x + y, 0) / rs.length
      if (r > best) { best = r; lagBest = lag / fps }
    }
    if (best >= 0.3) out.push(lagBest)
  }
  return out
}

function lagConsistency(A, B, fps, globalLag) {
  const w = windowLags(A, B, fps)
  const near = w.filter((l) => Math.abs(l - globalLag) <= 0.1).length
  return { n: w.length, near, frac: w.length ? near / w.length : NaN, lags: w }
}

function run(clips, data) {
  const parse = (c) => { const m = c.match(/^(.+)_att(\d+)_([fsd])$/); return m && { subj: m[1], att: +m[2], view: m[3] } }
  const byKey = {}
  for (const c of clips) { const p = parse(c); if (p) byKey[`${p.subj}|${p.att}|${p.view}`] = c }
  const fmt = (x, d = 2) => (Number.isNaN(x) ? '  nan' : x.toFixed(d).padStart(6))
  console.log(`clips=${clips.length} maxLag=±${MAX_LAG_S}s highpass=${HP_S}s minOverlap=${MIN_OVERLAP_S}s signals=${SIGNALS.join(',')}`)
  console.log('durations:', clips.map((c) => `${c}=${data[c].dur.toFixed(2)}`).join(' '))
  console.log('apparent view (median image shoulder|hip width / torso length; ~0.7+ front, ~0.2 side):')
  for (const c of clips) console.log(`  ${c.padEnd(12)} shoulder=${data[c].view.shoulder.toFixed(2)} hip=${data[c].view.hip.toFixed(2)}`)
  console.log('\n== Same attempt, different views (lag>0: event later in first clip) ==')
  console.log('pair                      lagS      r  sharp | per-signal r at that lag (peak r @ own lag)')
  const same = [], ctrl = []
  const pairs = [['f', 's'], ['f', 'd'], ['s', 'd']]
  const subjAtts = [...new Set(clips.map(parse).filter(Boolean).map((p) => `${p.subj}|${p.att}`))]
  const lagsBy = {}
  for (const sa of subjAtts) {
    for (const [va, vb] of pairs) {
      const a = byKey[`${sa}|${va}`], b = byKey[`${sa}|${vb}`]
      if (!a || !b) { console.log(`${sa.replace('|', ' att')} ${va}-${vb}: missing clip`); continue }
      const x = xcorr(data[a], data[b], data[a].fps)
      same.push(x)
      lagsBy[`${sa}|${va}${vb}`] = x.lagS
      const wc = lagConsistency(data[a], data[b], data[a].fps, x.lagS)
      x.frac = wc.frac
      console.log(`${(a + ' ~ ' + vb).padEnd(22)} ${fmt(x.lagS)} ${fmt(x.r)} ${fmt(x.sharp)} win=${wc.near}/${wc.n} [${wc.lags.map((l) => l.toFixed(2)).join(' ')}] | ` +
        SIGNALS.map((s) => `${s}=${fmt(x.perSig[s].rAtComb)}(${fmt(x.perSig[s].peak)}@${x.perSig[s].lagS.toFixed(2)})`).join(' '))
    }
    const fs = lagsBy[`${sa}|fs`], fd = lagsBy[`${sa}|fd`], sd = lagsBy[`${sa}|sd`]
    if (fs != null && fd != null && sd != null) console.log(`   closure ${sa}: lag(f,s)+lag(s,d)-lag(f,d) = ${(fs + sd - fd).toFixed(3)} s`)
  }
  console.log('\n== Control: different attempts (same subject), all view pairs ==')
  for (const a of clips) for (const b of clips) {
    const pa = parse(a), pb = parse(b)
    if (!pa || !pb || pa.subj !== pb.subj || pa.att >= pb.att) continue
    const x = xcorr(data[a], data[b], data[a].fps)
    const wc = lagConsistency(data[a], data[b], data[a].fps, x.lagS)
    ctrl.push({ a, b, ...x, frac: wc.frac, win: `${wc.near}/${wc.n}` })
  }
  ctrl.sort((p, q) => q.r - p.r)
  for (const x of ctrl.slice(0, 8)) console.log(`${(x.a + ' ~ ' + x.b).padEnd(26)} lag=${fmt(x.lagS)} r=${fmt(x.r)} sharp=${fmt(x.sharp)} win=${x.win}`)
  const stats = (arr, k) => {
    const v = arr.map((x) => x[k]).filter((x) => !Number.isNaN(x)).sort((p, q) => p - q)
    return `n=${v.length} min=${v[0]?.toFixed(2)} median=${v[Math.floor(v.length / 2)]?.toFixed(2)} max=${v[v.length - 1]?.toFixed(2)}`
  }
  if (process.env.SYNC_ALL_PAIRS) {
    console.log('\n== Every pair of clips (any attempt, any view), by combined r ==')
    const all = []
    for (let i = 0; i < clips.length; i++) for (let j = i + 1; j < clips.length; j++) {
      const a = clips[i], b = clips[j]
      const x = xcorr(data[a], data[b], data[a].fps)
      const wc = lagConsistency(data[a], data[b], data[a].fps, x.lagS)
      all.push({ a, b, ...x, win: `${wc.near}/${wc.n}` })
    }
    all.sort((p, q) => q.r - p.r)
    for (const x of all) {
      const tag = parse(x.a)?.att === parse(x.b)?.att ? 'SAME-LABEL' : ''
      console.log(`${(x.a + ' ~ ' + x.b).padEnd(26)} lag=${fmt(x.lagS)} r=${fmt(x.r)} sharp=${fmt(x.sharp)} win=${x.win.padEnd(4)} hipY=${fmt(x.perSig.hipY.rAtComb)} knee=${fmt(x.perSig.knee.rAtComb)} ${tag}`)
    }
  }
  console.log('\n== Summary ==')
  console.log(`same attempt   r: ${stats(same, 'r')}   sharp: ${stats(same, 'sharp')}`)
  console.log(`control        r: ${stats(ctrl, 'r')}   sharp: ${stats(ctrl, 'sharp')}`)
  console.log(`window agreement (share of 6 s windows within ±0.1 s of the global lag): same ${stats(same, 'frac')} | control ${stats(ctrl, 'frac')}`)
}
