// Descriptive movement measures for phrase material, used by the phrase engine
// (phrase.ts) as its theme measures. Each one maps to a theme a teacher may name when watching
// a phrase: knees over toes, the head leading, a released head, a curve in the spine,
// reaching out, finishing a circle. They describe; they never grade. Values are given per
// clip and per episode so a dancer can compare two of their own attempts.
//
// Rules: a frame that lacks a needed landmark is a gap and is left out; nothing is filled
// in. MediaPipe has no spine points, so the "curve" here is a head–shoulders–hips proxy that
// mixes neck and upper-back flexion; it cannot tell the two apart.

import { LM, type Landmark, type PoseSeries } from '../pose/types'
import { bodySignals, detectEvents, GESTURE_OFF, runs, type BodySignals, type PhraseEvent } from './events'
import { LEG, median, mid, norm, seen, sub, type Side, type Vec3 } from './signals'

const DEG = 180 / Math.PI
const SIDES = ['left', 'right'] as const
type Series<T = number> = (T | null)[]

// ---------- thresholds ----------

/** Knee tracking is read on weight-bearing knees bent more than this (same as the engine). */
export const KNEE_BENT_DEG = 15
/** Speeds are central differences over ± this many seconds. */
export const SPEED_HALF_WINDOW_S = 0.1
/** An onset needs the speed to have stayed under its threshold for this long before. */
export const ONSET_QUIET_S = 0.25
/** An arm onset is paired with a head onset no further away than this. */
export const LEAD_PAIR_S = 0.5
/** A circle run needs this much swept angle... */
export const CIRCLE_MIN_DEG = 120
/** ...with the limb at least this share of its length away from its joint in that plane... */
export const CIRCLE_MIN_RADIUS = 0.4
/** ...and tolerates backwards steps adding up to this much. */
export const CIRCLE_BACKTRACK_DEG = 25
/** Arm counts as extended at or above this ratio of straight-line to segment length. */
export const EXTENDED_RATIO = 0.95

// ---------- small helpers ----------

const nn = (x: number | null | undefined): x is number => x !== null && x !== undefined && Number.isFinite(x)
const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z
const cross = (a: Vec3, b: Vec3): Vec3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x })
const scale = (a: Vec3, k: number): Vec3 => ({ x: a.x * k, y: a.y * k, z: a.z * k })
const unit = (a: Vec3): Vec3 | null => {
  const l = norm(a)
  return l > 1e-9 ? scale(a, 1 / l) : null
}

export function quantile(values: number[], q: number): number | null {
  if (!values.length) return null
  const s = [...values].sort((a, b) => a - b)
  const x = q * (s.length - 1)
  const lo = Math.floor(x)
  const hi = Math.min(s.length - 1, lo + 1)
  return s[lo] + (s[hi] - s[lo]) * (x - lo)
}

const finite = (s: Series): number[] => s.filter(nn)
const r = (x: number | null, k = 10) => (x === null ? null : Math.round(x * k) / k)

/** Central-difference speed of a 3D point series (units per second), null near gaps. */
export function speed(points: Series<Vec3>, t: number[], half: number): Series {
  return points.map((_, i) => {
    const a = points[i - half]
    const b = points[i + half]
    if (!a || !b) return null
    const dt = t[i + half] - t[i - half]
    return dt > 0 ? norm(sub(b, a)) / dt : null
  })
}

/** Pelvis frame (same convention as events.ts): lateral left→right hip, front = up × lateral. */
function frame(w: Landmark[]): { lat: Vec3; fwd: Vec3 } | null {
  const l = sub(w[LM.rightHip], w[LM.leftHip])
  const lat = unit({ x: l.x, y: 0, z: l.z })
  if (!lat) return null
  return { lat, fwd: { x: -lat.z, y: 0, z: lat.x } }
}

/** Trunk frame: up = hips-mid → shoulders-mid, lateral = shoulder line made perpendicular to it, front = up × lateral. */
function trunkFrame(w: Landmark[]): { up: Vec3; lat: Vec3; fwd: Vec3 } | null {
  const up = unit(sub(mid(w[LM.leftShoulder], w[LM.rightShoulder]), mid(w[LM.leftHip], w[LM.rightHip])))
  if (!up) return null
  const l = sub(w[LM.rightShoulder], w[LM.leftShoulder])
  const lat = unit(sub(l, scale(up, dot(l, up))))
  if (!lat) return null
  return { up, lat, fwd: cross(up, lat) }
}

// ---------- 1. knee over toes ----------

export interface KneeEpisode {
  kind: 'plie' | 'single_leg'
  side: Side
  start: number
  end: number
  /** Median signed deviation, deg: > 0 knee inside (medial of) the foot line, < 0 outside. */
  medianDeg: number | null
  /** 90th percentile of the unsigned deviation, deg. */
  p90AbsDeg: number | null
  frames: number
}

/**
 * Signed knee tracking: the engine's definition (horizontal angle between ankle → knee and
 * heel → toe on a bent knee) with a sign, > 0 when the knee falls inside the foot line
 * (towards the other leg). Null when the knee is straighter than KNEE_BENT_DEG or a
 * direction is shorter than 1 cm.
 */
export function signedKneeDev(w: Landmark[], side: Side): number | null {
  const { hip, knee, ankle, heel, toe } = LEG[side]
  if (!seen(w, [hip, knee, ankle, heel, toe, LM.leftHip, LM.rightHip])) return null
  const a = sub(w[hip], w[knee])
  const b = sub(w[ankle], w[knee])
  const inner = Math.acos(Math.max(-1, Math.min(1, dot(a, b) / (norm(a) * norm(b))))) * DEG
  if (180 - inner <= KNEE_BENT_DEG) return null
  const k = sub(w[knee], w[ankle])
  const f = sub(w[toe], w[heel])
  const kh = { x: k.x, y: 0, z: k.z }
  const fh = { x: f.x, y: 0, z: f.z }
  if (Math.hypot(kh.x, kh.z) < 0.01 || Math.hypot(fh.x, fh.z) < 0.01) return null
  const fr = frame(w)
  if (!fr) return null
  // Medial = towards the other hip.
  const medial = side === 'left' ? fr.lat : scale(fr.lat, -1)
  let p: Vec3 = { x: -fh.z, y: 0, z: fh.x }
  if (dot(p, medial) < 0) p = scale(p, -1)
  return Math.atan2(dot(kh, unit(p) as Vec3), dot(kh, unit(fh) as Vec3)) * DEG
}

/**
 * Knee over toes in the picture (front camera only): horizontal offset of the knee from the
 * toe, in shin lengths, > 0 towards the other leg. Independent of MediaPipe's depth estimate,
 * which is the weak axis of a front view.
 */
export function imageKneeOffset(im: Landmark[], side: Side, aspect: number): number | null {
  const { hip, knee, ankle, toe } = LEG[side]
  const otherHip = side === 'left' ? LM.rightHip : LM.leftHip
  if (!seen(im, [hip, knee, ankle, toe, otherHip])) return null
  const shin = Math.hypot((im[knee].x - im[ankle].x) * aspect, im[knee].y - im[ankle].y)
  if (!(shin > 1e-6)) return null
  const medialSign = Math.sign(im[otherHip].x - im[hip].x) || 1
  return (medialSign * (im[knee].x - im[toe].x) * aspect) / shin
}

export function kneeEpisodes(series: PoseSeries, events: PhraseEvent[], sig: BodySignals): KneeEpisode[] {
  const out: KneeEpisode[] = []
  const measure = (kind: KneeEpisode['kind'], side: Side, e: PhraseEvent) => {
    const vals: number[] = []
    for (let i = e.i0; i < e.i1; i++) {
      const w = series.frames[i].world
      // Only a weight-bearing foot: not the lifted one.
      const raise = sig.footRaise[side][i]
      if (!w || !nn(raise) || raise > GESTURE_OFF) continue
      const d = signedKneeDev(w, side)
      if (nn(d)) vals.push(d)
    }
    out.push({
      kind,
      side,
      start: e.start,
      end: e.end,
      medianDeg: r(median(vals)),
      p90AbsDeg: r(quantile(vals.map(Math.abs), 0.9)),
      frames: vals.length,
    })
  }
  for (const e of events) {
    if (e.kind === 'plie') for (const s of SIDES) measure('plie', s, e)
    if (e.kind === 'gesture') measure('single_leg', e.values.side === 'left' ? 'right' : 'left', e)
  }
  return out
}

// ---------- 2. head lead ----------

export interface LeadPair {
  /** Arm onset time, s. */
  armT: number
  headT: number
  /** armT − headT, s: > 0 the head started first. */
  latencyS: number
}

export interface HeadLead {
  pairs: LeadPair[]
  medianLatencyS: number | null
  /** Share of paired onsets in which the head started first. */
  headFirstShare: number | null
  /** Lag (s) at which head speed best matches wrist speed: > 0 the head leads. */
  xcorrLagS: number | null
  armOnsets: number
  headOnsets: number
}

/** Onsets: frames where the speed rises through `thr` after ONSET_QUIET_S under it. */
export function onsets(sp: Series, t: number[], thr: number, quietS = ONSET_QUIET_S): number[] {
  const out: number[] = []
  let quietSince: number | null = null
  for (let i = 0; i < sp.length; i++) {
    const v = sp[i]
    if (!nn(v)) {
      quietSince = null
      continue
    }
    if (v < thr) {
      if (quietSince === null) quietSince = t[i]
    } else {
      if (quietSince !== null && t[i] - quietSince >= quietS) out.push(i)
      quietSince = null
    }
  }
  return out
}

/** Adaptive onset threshold: 30% of the way from the 20th to the 95th percentile. */
function onsetThreshold(sp: Series): number | null {
  const v = finite(sp)
  const lo = quantile(v, 0.2)
  const hi = quantile(v, 0.95)
  return lo === null || hi === null ? null : lo + 0.3 * (hi - lo)
}

export function headLead(series: PoseSeries, leg: number): HeadLead {
  const t = series.frames.map((f) => f.t)
  const half = Math.max(1, Math.round(SPEED_HALF_WINDOW_S * series.fps))
  const rel = (idx: number[], fn: (w: Landmark[]) => Vec3): Series<Vec3> =>
    series.frames.map((f) => (seen(f.world, [...idx, LM.leftShoulder, LM.rightShoulder]) ? scale(fn(f.world), 1 / leg) : null))
  const shMid = (w: Landmark[]) => mid(w[LM.leftShoulder], w[LM.rightShoulder])
  // Head relative to the shoulders, wrists relative to the shoulders: motion of the trunk itself is removed.
  const head = rel([LM.leftEar, LM.rightEar], (w) => sub(mid(w[LM.leftEar], w[LM.rightEar]), shMid(w)))
  const wl = rel([LM.leftWrist], (w) => sub(w[LM.leftWrist], shMid(w)))
  const wr = rel([LM.rightWrist], (w) => sub(w[LM.rightWrist], shMid(w)))
  const hs = speed(head, t, half)
  const sl = speed(wl, t, half)
  const sr = speed(wr, t, half)
  const arm = sl.map((a, i) => (nn(a) && nn(sr[i]) ? Math.max(a, sr[i] as number) : nn(a) ? a : sr[i]))

  const th = onsetThreshold(hs)
  const ta = onsetThreshold(arm)
  const ho = th === null ? [] : onsets(hs, t, th)
  const ao = ta === null ? [] : onsets(arm, t, ta)
  const pairs: LeadPair[] = []
  for (const a of ao) {
    let best: number | null = null
    for (const h of ho) if (Math.abs(t[a] - t[h]) <= LEAD_PAIR_S && (best === null || Math.abs(t[a] - t[h]) < Math.abs(t[a] - t[best]))) best = h
    if (best !== null) pairs.push({ armT: t[a], headT: t[best], latencyS: Math.round((t[a] - t[best]) * 1000) / 1000 })
  }

  // Cross-correlation of the two speed signals (mean removed) over ±LEAD_PAIR_S.
  let xcorrLagS: number | null = null
  const maxLag = Math.round(LEAD_PAIR_S * series.fps)
  const mh = median(finite(hs))
  const ma = median(finite(arm))
  if (mh !== null && ma !== null) {
    let best = -Infinity
    for (let lag = -maxLag; lag <= maxLag; lag++) {
      let s = 0
      let c = 0
      for (let i = 0; i < hs.length; i++) {
        const h = hs[i]
        const a = arm[i + lag]
        if (!nn(h) || !nn(a)) continue
        s += (h - mh) * (a - ma)
        c++
      }
      if (c > series.fps && s / c > best) {
        best = s / c
        xcorrLagS = lag / series.fps
      }
    }
  }
  const lat = pairs.map((p) => p.latencyS)
  return {
    pairs,
    medianLatencyS: lat.length ? Math.round((median(lat) as number) * 1000) / 1000 : null,
    headFirstShare: lat.length ? Math.round((lat.filter((x) => x > 0).length / lat.length) * 100) / 100 : null,
    xcorrLagS: xcorrLagS === null ? null : Math.round(xcorrLagS * 1000) / 1000,
    armOnsets: ao.length,
    headOnsets: ho.length,
  }
}

// ---------- 3. head / neck range and smoothness, 4. head–trunk curve ----------

export interface HeadTrunk {
  /** Neck angle: ears-mid − shoulders-mid against the trunk line, deg, per frame. */
  neck: Series
  /** Signed head–trunk curve, deg: > 0 the head is folded towards the chest (C-curve), < 0 arched back. */
  curve: Series
  /** Unsigned head–shoulders–hips angle in the picture (180 − angle), deg; for side and diagonal views. */
  curveImage: Series
}

export function headTrunk(series: PoseSeries): HeadTrunk {
  const need = [LM.leftEar, LM.rightEar, LM.leftShoulder, LM.rightShoulder, LM.leftHip, LM.rightHip]
  const neck: Series = []
  const curve: Series = []
  const curveImage: Series = []
  const aspect = series.width / series.height
  for (const f of series.frames) {
    const w = f.world
    if (!seen(w, need)) {
      neck.push(null)
      curve.push(null)
    } else {
      const sm = mid(w[LM.leftShoulder], w[LM.rightShoulder])
      const t = unit(sub(sm, mid(w[LM.leftHip], w[LM.rightHip])))
      const h = unit(sub(mid(w[LM.leftEar], w[LM.rightEar]), sm))
      const lat = unit(sub(w[LM.rightShoulder], w[LM.leftShoulder]))
      if (!t || !h || !lat) {
        neck.push(null)
        curve.push(null)
      } else {
        neck.push(Math.acos(Math.max(-1, Math.min(1, dot(t, h)))) * DEG)
        // Chest normal: trunk × lateral (points to the front when upright; see events.ts).
        const chest = unit(cross(t, lat))
        curve.push(chest ? Math.atan2(dot(h, chest), dot(h, t)) * DEG : null)
      }
    }
    const im = f.image
    if (!seen(im, need)) {
      curveImage.push(null)
      continue
    }
    const p = (q: Vec3) => ({ x: q.x * aspect, y: q.y, z: 0 })
    const sm = p(mid(im[LM.leftShoulder], im[LM.rightShoulder]))
    const a = sub(p(mid(im[LM.leftEar], im[LM.rightEar])), sm)
    const b = sub(p(mid(im[LM.leftHip], im[LM.rightHip])), sm)
    const d = norm(a) * norm(b)
    curveImage.push(d > 0 ? 180 - Math.acos(Math.max(-1, Math.min(1, dot(a, b) / d))) * DEG : null)
  }
  return { neck, curve, curveImage }
}

export interface HeadMotion {
  /** p95 − p5 of the neck angle, deg. */
  neckRangeDeg: number | null
  /** Median and 90th percentile of the neck angle speed, deg/s. */
  neckSpeedMedian: number | null
  neckSpeedP90: number | null
  /** Speed peaks of the head relative to the shoulders per second of tracked time. */
  headPeaksPerS: number | null
  /** RMS jerk of the head relative to the shoulders, leg lengths/s³ (noise-sensitive: compare like with like). */
  headJerkRms: number | null
}

export function headMotion(series: PoseSeries, neck: Series, leg: number): HeadMotion {
  const t = series.frames.map((f) => f.t)
  const half = Math.max(1, Math.round(SPEED_HALF_WINDOW_S * series.fps))
  const nv = finite(neck)
  const nsp = neck.map((_, i) => {
    const a = neck[i - half]
    const b = neck[i + half]
    return nn(a) && nn(b) ? Math.abs(b - a) / (t[i + half] - t[i - half]) : null
  })
  const head: Series<Vec3> = series.frames.map((f) =>
    seen(f.world, [LM.leftEar, LM.rightEar, LM.leftShoulder, LM.rightShoulder])
      ? scale(sub(mid(f.world[LM.leftEar], f.world[LM.rightEar]), mid(f.world[LM.leftShoulder], f.world[LM.rightShoulder])), 1 / leg)
      : null,
  )
  const hs = speed(head, t, half)
  const thr = onsetThreshold(hs)
  let peaks = 0
  for (let i = 1; i + 1 < hs.length; i++) {
    const a = hs[i - 1]
    const b = hs[i]
    const c = hs[i + 1]
    if (nn(a) && nn(b) && nn(c) && thr !== null && b > thr && b >= a && b > c) peaks++
  }
  const tracked = finite(hs).length / series.fps
  // Jerk: third difference over `half`-frame steps.
  const jerks: number[] = []
  const h = half / series.fps
  for (let i = 0; i + 3 * half < head.length; i++) {
    const p = [0, 1, 2, 3].map((k) => head[i + k * half])
    if (p.some((q) => !q)) continue
    const [a, b, c, d] = p as Vec3[]
    const j = { x: d.x - 3 * c.x + 3 * b.x - a.x, y: d.y - 3 * c.y + 3 * b.y - a.y, z: d.z - 3 * c.z + 3 * b.z - a.z }
    jerks.push(norm(j) / h ** 3)
  }
  const lo = quantile(nv, 0.05)
  const hi = quantile(nv, 0.95)
  return {
    neckRangeDeg: lo === null || hi === null ? null : r(hi - lo),
    neckSpeedMedian: r(median(finite(nsp))),
    neckSpeedP90: r(quantile(finite(nsp), 0.9)),
    headPeaksPerS: tracked > 0 ? r(peaks / tracked, 100) : null,
    headJerkRms: jerks.length ? r(Math.sqrt(jerks.reduce((s, x) => s + x * x, 0) / jerks.length), 1) : null,
  }
}

// ---------- 5. distal reach ----------

export interface ReachSide {
  /** |wrist − shoulders-mid| / arm length: p90 and peak. */
  reachP90: number | null
  reachPeak: number | null
  /** Seconds with the elbow extended (straight-line ≥ EXTENDED_RATIO of segment length) and longest such run. */
  extendedS: number | null
  longestExtendedS: number | null
}

export function armReach(series: PoseSeries): Record<Side, ReachSide> {
  const idx = {
    left: { sh: LM.leftShoulder, el: LM.leftElbow, wr: LM.leftWrist },
    right: { sh: LM.rightShoulder, el: LM.rightElbow, wr: LM.rightWrist },
  }
  const out = {} as Record<Side, ReachSide>
  for (const s of SIDES) {
    const { sh, el, wr } = idx[s]
    const need = [sh, el, wr, LM.leftShoulder, LM.rightShoulder]
    const lens: number[] = []
    for (const f of series.frames) if (seen(f.world, need)) lens.push(norm(sub(f.world[sh], f.world[el])) + norm(sub(f.world[el], f.world[wr])))
    const arm = median(lens)
    const reach: Series = []
    const ext: Series = []
    for (const f of series.frames) {
      if (!seen(f.world, need) || !arm) {
        reach.push(null)
        ext.push(null)
        continue
      }
      const w = f.world
      reach.push(norm(sub(w[wr], mid(w[LM.leftShoulder], w[LM.rightShoulder]))) / arm)
      ext.push(norm(sub(w[wr], w[sh])) / (norm(sub(w[sh], w[el])) + norm(sub(w[el], w[wr]))))
    }
    const rv = finite(reach)
    const n = ext.length
    const extRuns = runs(n, (i) => nn(ext[i]) && (ext[i] as number) >= EXTENDED_RATIO, (i) => (nn(ext[i]) ? (ext[i] as number) < EXTENDED_RATIO : null), 1)
    const total = extRuns.reduce((a, [i0, i1]) => a + i1 - i0, 0)
    const longest = extRuns.reduce((a, [i0, i1]) => Math.max(a, i1 - i0), 0)
    out[s] = {
      reachP90: r(quantile(rv, 0.9), 100),
      reachPeak: r(rv.length ? Math.max(...rv) : null, 100),
      extendedS: rv.length ? r(total / series.fps, 100) : null,
      longestExtendedS: rv.length ? r(longest / series.fps, 100) : null,
    }
  }
  return out
}

// ---------- 6. circles (trajectory closure) ----------

export interface CircleRun {
  limb: 'left_arm' | 'right_arm' | 'left_leg' | 'right_leg'
  plane: 'frontal' | 'sagittal' | 'horizontal'
  start: number
  end: number
  /** Swept angle around the joint in that plane, deg (360 = a full circle). */
  sweptDeg: number
  /** Distance between the end and the start position, in limb lengths (0 = closed). */
  closure: number
}

/**
 * Angle swept by a limb (wrist about its shoulder, ankle about its hip) in three body planes
 * (arms in the trunk frame, legs in the pelvis frame, so turning, folding or tilting the
 * body does not count). A run is a stretch where the
 * angle keeps going one way (backwards steps up to CIRCLE_BACKTRACK_DEG in total) with the
 * limb at least CIRCLE_MIN_RADIUS of its length out of the joint's axis in that plane. Legs
 * are only read while that foot is off the floor.
 */
export function circles(series: PoseSeries, sig: BodySignals): CircleRun[] {
  const limbs = [
    { limb: 'left_arm', side: 'left', joint: LM.leftShoulder, end: LM.leftWrist, arm: true },
    { limb: 'right_arm', side: 'right', joint: LM.rightShoulder, end: LM.rightWrist, arm: true },
    { limb: 'left_leg', side: 'left', joint: LM.leftHip, end: LM.leftAnkle, arm: false },
    { limb: 'right_leg', side: 'right', joint: LM.rightHip, end: LM.rightAnkle, arm: false },
  ] as const
  const out: CircleRun[] = []
  const n = series.frames.length
  for (const L of limbs) {
    const lens: number[] = []
    const local: Series<{ f: number; o: number; u: number }> = series.frames.map((fr, i) => {
      const w = fr.world
      if (!seen(w, [L.joint, L.end, LM.leftHip, LM.rightHip])) return null
      if (!L.arm && !(nn(sig.footRaise[L.side][i]) && (sig.footRaise[L.side][i] as number) > GESTURE_OFF)) return null
      const d = sub(w[L.end], w[L.joint])
      if (L.arm) {
        // Arms in the trunk frame, so folding or tilting the trunk does not count as an arm circle.
        if (!seen(w, [LM.leftShoulder, LM.rightShoulder])) return null
        const tf = trunkFrame(w)
        if (!tf) return null
        lens.push(norm(d))
        const outward = L.side === 'right' ? tf.lat : scale(tf.lat, -1)
        return { f: dot(d, tf.fwd), o: dot(d, outward), u: dot(d, tf.up) }
      }
      const fm = frame(w)
      if (!fm) return null
      lens.push(norm(d))
      const outward = L.side === 'right' ? fm.lat : scale(fm.lat, -1)
      return { f: dot(d, fm.fwd), o: dot(d, outward), u: -d.y }
    })
    const limbLen = quantile(lens, 0.9)
    if (!limbLen) continue
    const planes = {
      frontal: (p: { f: number; o: number; u: number }) => [p.o, p.u],
      sagittal: (p: { f: number; o: number; u: number }) => [p.f, p.u],
      horizontal: (p: { f: number; o: number; u: number }) => [p.f, p.o],
    } as const
    for (const plane of ['frontal', 'sagittal', 'horizontal'] as const) {
      const ang: Series = local.map((p) => {
        if (!p) return null
        const [a, b] = planes[plane](p)
        return Math.hypot(a, b) >= CIRCLE_MIN_RADIUS * limbLen ? Math.atan2(b, a) * DEG : null
      })
      let i = 0
      while (i < n) {
        if (!nn(ang[i])) {
          i++
          continue
        }
        let total = 0
        let back = 0
        let dir = 0
        let j = i
        let last = i
        while (j + 1 < n && nn(ang[j + 1])) {
          let d = (ang[j + 1] as number) - (ang[j] as number)
          d -= 360 * Math.round(d / 360)
          if (dir === 0 && Math.abs(d) > 1) dir = Math.sign(d)
          if (dir !== 0 && Math.sign(d) !== dir) {
            back += Math.abs(d)
            if (back > CIRCLE_BACKTRACK_DEG) break
          } else if (dir !== 0) last = j + 1
          total += d
          j++
        }
        const swept = Math.abs(total)
        if (swept >= CIRCLE_MIN_DEG) {
          const a = local[i] as { f: number; o: number; u: number }
          const b = local[last] as { f: number; o: number; u: number }
          out.push({
            limb: L.limb,
            plane,
            start: series.frames[i].t,
            end: series.frames[last].t,
            sweptDeg: Math.round(swept),
            closure: Math.round((Math.hypot(a.f - b.f, a.o - b.o, a.u - b.u) / limbLen) * 100) / 100,
          })
        }
        i = Math.max(i + 1, last + 1, j + 1)
      }
    }
  }
  // The same circle shows in more than one plane; keep the plane with the largest sweep per overlapping limb run.
  out.sort((a, b) => b.sweptDeg - a.sweptDeg)
  const kept: CircleRun[] = []
  for (const c of out) if (!kept.some((k) => k.limb === c.limb && k.start < c.end && c.start < k.end)) kept.push(c)
  return kept.sort((a, b) => a.start - b.start)
}

// ---------- all together ----------

export interface ExpressiveSummary {
  events: PhraseEvent[]
  knee: KneeEpisode[]
  lead: HeadLead | null
  head: HeadMotion | null
  curve: { p95Deg: number | null; p5Deg: number | null; imageP95Deg: number | null }
  reach: Record<Side, ReachSide>
  circles: CircleRun[]
}

export function expressiveSummary(series: PoseSeries): ExpressiveSummary {
  const sig = bodySignals(series)
  const events = detectEvents(series, sig)
  const ht = headTrunk(series)
  const leg = sig.leg
  return {
    events,
    knee: kneeEpisodes(series, events, sig),
    lead: leg ? headLead(series, leg) : null,
    head: leg ? headMotion(series, ht.neck, leg) : null,
    curve: {
      p95Deg: r(quantile(finite(ht.curve), 0.95)),
      p5Deg: r(quantile(finite(ht.curve), 0.05)),
      imageP95Deg: r(quantile(finite(ht.curveImage), 0.95)),
    },
    reach: armReach(series),
    circles: circles(series, sig),
  }
}
