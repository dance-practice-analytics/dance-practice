// Phrase events. Used by the phrase engine (phrase.ts, movement 'phrase'); the relevé engine does not use them.
//
// The relevé engine (phases.ts) assumes one held relevé per clip and measures the first
// lift. Longer clips hold a phrase: several relevés, leg gestures (développé, attitude,
// arabesque), tilts, pliés and turns. This module reads per-frame body signals from the
// world landmarks and returns a timeline of events, each with its own values, so a later
// engine version can (a) measure every relevé in a clip and (b) measure leg extensions.
//
// Same rules as the engine: values only, never a score; a frame without the landmarks a
// signal needs is a gap (null), never filled in; every threshold is named and documented.
// World landmarks are metres, hip-centred, y down. Lengths are given in leg lengths (L, the
// clip's median hip–knee–ankle length, both legs) so they do not depend on body size.

import { LM, type Landmark, type PoseSeries } from '../pose/types'
import { LEG, SHOULDERS, angleDeg, median, mid, norm, seen, shoulderYaw, sub, type Side, type Vec3 } from './signals'

const DEG = 180 / Math.PI

// ---------- thresholds ----------

/** A foot is off the floor when its lowest point is this many leg lengths above the
 *  other foot's lowest point (≈ 9 cm for a 0.75 m leg)... */
export const GESTURE_ON = 0.12
/** ...and back on it below this (hysteresis). */
export const GESTURE_OFF = 0.06
/** Minimum duration of a gesture, s. */
export const GESTURE_MIN_S = 0.2
/** Both feet count as down while their lowest points differ by less than this, L. */
export const BOTH_DOWN_MAX = 0.06
/** Relevé: both heels this far above their own flat-foot level (L)... */
export const RELEVE_ON = 0.04
export const RELEVE_OFF = 0.025
/** ...with both knees straighter than this (a bent knee tips the foot and fakes a heel lift). */
export const STRAIGHT_KNEE_DEG = 25
export const RELEVE_MIN_S = 0.2
/** Plié: both feet down, both knees bent more than this. */
export const PLIE_KNEE_DEG = 30
export const PLIE_MIN_S = 0.2
/** Tilt / bend: trunk more than this from vertical. */
export const TILT_DEG = 30
export const TILT_MIN_S = 0.3
/** Turn: unwrapped shoulder yaw moves at least this far in one direction... */
export const TURN_MIN_DEG = 120
/** ...counted while it moves faster than this (°/s) and pauses no longer than TURN_PAUSE_S. */
export const TURN_RATE_DEG_S = 60
export const TURN_PAUSE_S = 0.15
/** "Held" part of a gesture: working leg within this many degrees of its peak elevation. */
export const HOLD_BAND_DEG = 10
/** Below this horizontal reach (L) a direction is noise. */
const MIN_REACH = 0.08

// ---------- per-frame signals ----------

export interface BodySignals {
  t: number[]
  /** Clip leg length, m (median of both legs). */
  leg: number | null
  /** Trunk (hip mid → shoulder mid) angle from vertical, deg. */
  trunkDeg: (number | null)[]
  /** Direction of the lean in the pelvis frame, deg: 0 front, 90 towards the right hip, −90 left, ±180 back. */
  trunkAz: (number | null)[]
  /** Knee flexion, deg (0 = straight). */
  knee: Record<Side, (number | null)[]>
  /** Hip → ankle angle from straight down, deg (90 = leg horizontal). */
  legElev: Record<Side, (number | null)[]>
  /** Direction of hip → ankle in the pelvis frame, deg (same convention as trunkAz). */
  legAz: Record<Side, (number | null)[]>
  /** Height of this foot's lowest point above the other foot's, L (>0 = this foot higher). */
  footRaise: Record<Side, (number | null)[]>
  /** Ankle height relative to the other leg's knee and hip, L (>0 = above). */
  ankleOverKnee: Record<Side, (number | null)[]>
  ankleOverHip: Record<Side, (number | null)[]>
  /** Heel above the toe of the same foot, L, relative to the foot's flat level (heelFlat). */
  heelLift: Record<Side, (number | null)[]>
  heelFlat: Record<Side, number | null>
  /** Working-side hip above the other hip, L (>0 = right hip higher). */
  hipTiltR: (number | null)[]
  /** Unwrapped shoulder-line yaw, deg. */
  yaw: (number | null)[]
  /** Both feet point backwards in the pelvis frame: left/right labels are probably swapped. */
  labelDoubt: (boolean | null)[]
}

type Pts = Landmark[]

function horiz(v: Vec3): { x: number; z: number } {
  return { x: v.x, z: v.z }
}

/**
 * Pelvis frame: lateral = left hip → right hip, forward = up × lateral (both horizontal).
 * The front follows from the left/right labels alone (y points down, so up = −y). Cues such
 * as the nose were tried and dropped: in a forward fold the head hangs and the nose points
 * backwards. When the tracker mislabels left and right (dancer facing away), front/back and
 * left/right flip together; `labelDoubt` flags those frames from the feet.
 */
function pelvisFrame(w: Pts): { lat: { x: number; z: number }; fwd: { x: number; z: number } } | null {
  const l = horiz(sub(w[LM.rightHip], w[LM.leftHip]))
  const ll = Math.hypot(l.x, l.z)
  if (!(ll > 1e-6)) return null
  const lat = { x: l.x / ll, z: l.z / ll }
  return { lat, fwd: { x: -lat.z, z: lat.x } }
}

/** True when both feet point backwards in the pelvis frame (toes behind heels): a likely left/right mislabel. */
function feetPointBack(w: Pts, f: NonNullable<ReturnType<typeof pelvisFrame>>): boolean | null {
  if (!seen(w, [LM.leftHeel, LM.rightHeel, LM.leftFootIndex, LM.rightFootIndex])) return null
  const a = sub(w[LM.leftFootIndex], w[LM.leftHeel])
  const b = sub(w[LM.rightFootIndex], w[LM.rightHeel])
  const fa = a.x * f.fwd.x + a.z * f.fwd.z
  const fb = b.x * f.fwd.x + b.z * f.fwd.z
  return fa < 0 && fb < 0
}

function azimuth(v: Vec3, f: NonNullable<ReturnType<typeof pelvisFrame>>, leg: number): number | null {
  const fw = v.x * f.fwd.x + v.z * f.fwd.z
  const lt = v.x * f.lat.x + v.z * f.lat.z
  if (Math.hypot(fw, lt) < MIN_REACH * leg) return null
  return Math.atan2(lt, fw) * DEG
}

const footLow = (w: Pts, s: Side) => Math.max(w[LEG[s].heel].y, w[LEG[s].toe].y)
const other = (s: Side): Side => (s === 'left' ? 'right' : 'left')

function quantile(values: number[], q: number): number | null {
  if (!values.length) return null
  const s = [...values].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))]
}

export function bodySignals(series: PoseSeries): BodySignals {
  const { frames } = series
  const n = frames.length
  const arr = () => new Array<number | null>(n).fill(null)
  const both = () => ({ left: arr(), right: arr() })

  // Leg length: median over both legs of every frame with hip, knee and ankle tracked.
  const lengths: number[] = []
  for (const f of frames) {
    for (const s of ['left', 'right'] as const) {
      const { hip, knee, ankle } = LEG[s]
      if (!seen(f.world, [hip, knee, ankle])) continue
      const w = f.world
      lengths.push(norm(sub(w[hip], w[knee])) + norm(sub(w[knee], w[ankle])))
    }
  }
  const leg = median(lengths)

  const out: BodySignals = {
    t: frames.map((f) => f.t),
    leg,
    trunkDeg: arr(),
    trunkAz: arr(),
    knee: both(),
    legElev: both(),
    legAz: both(),
    footRaise: both(),
    ankleOverKnee: both(),
    ankleOverHip: both(),
    heelLift: both(),
    heelFlat: { left: null, right: null },
    hipTiltR: arr(),
    yaw: shoulderYaw(series).yaw,
    labelDoubt: new Array<boolean | null>(n).fill(null),
  }
  if (!leg) return out
  const down: Vec3 = { x: 0, y: 1, z: 0 }
  const heelRaw = both()

  frames.forEach((f, i) => {
    const w = f.world
    if (!w) return
    const torso = [...SHOULDERS, LM.leftHip, LM.rightHip]
    const frame = seen(w, [LM.leftHip, LM.rightHip]) ? pelvisFrame(w) : null
    if (frame) out.labelDoubt[i] = feetPointBack(w, frame)
    if (seen(w, torso)) {
      const v = sub(mid(w[LM.leftShoulder], w[LM.rightShoulder]), mid(w[LM.leftHip], w[LM.rightHip]))
      out.trunkDeg[i] = angleDeg(v, { x: 0, y: -1, z: 0 })
      if (frame) out.trunkAz[i] = azimuth(v, frame, leg)
    }
    if (seen(w, [LM.leftHip, LM.rightHip])) out.hipTiltR[i] = (w[LM.leftHip].y - w[LM.rightHip].y) / leg
    for (const s of ['left', 'right'] as const) {
      const o = other(s)
      const { hip, knee, ankle, heel, toe } = LEG[s]
      if (seen(w, [hip, knee, ankle])) {
        const a = angleDeg(sub(w[hip], w[knee]), sub(w[ankle], w[knee]))
        out.knee[s][i] = a === null ? null : 180 - a
        const hv = sub(w[ankle], w[hip])
        out.legElev[s][i] = angleDeg(hv, down)
        if (frame) out.legAz[s][i] = azimuth(hv, frame, leg)
      }
      if (seen(w, [heel, toe, LEG[o].heel, LEG[o].toe])) out.footRaise[s][i] = (footLow(w, o) - footLow(w, s)) / leg
      if (seen(w, [ankle, LEG[o].knee, LEG[o].hip])) {
        out.ankleOverKnee[s][i] = (w[LEG[o].knee].y - w[ankle].y) / leg
        out.ankleOverHip[s][i] = (w[LEG[o].hip].y - w[ankle].y) / leg
      }
      if (seen(w, [heel, toe])) heelRaw[s][i] = (w[toe].y - w[heel].y) / leg
    }
  })

  // Flat-foot level of each heel: a low quantile of heel-above-toe over the frames with both
  // feet down and both knees straight. A fixed window at the start (the relevé engine's
  // 0.5–1.0 s) fails on phrases that start moving at once.
  for (const s of ['left', 'right'] as const) {
    const flat: number[] = []
    for (let i = 0; i < n; i++) {
      const h = heelRaw[s][i]
      const r = out.footRaise.left[i]
      const kl = out.knee.left[i]
      const kr = out.knee.right[i]
      if (h === null || r === null || kl === null || kr === null) continue
      if (Math.abs(r) < BOTH_DOWN_MAX && kl < STRAIGHT_KNEE_DEG && kr < STRAIGHT_KNEE_DEG) flat.push(h)
    }
    const level = quantile(flat, 0.25)
    out.heelFlat[s] = level
    out.heelLift[s] = heelRaw[s].map((h) => (h === null || level === null ? null : h - level))
  }
  return out
}

// ---------- events ----------

export type EventKind = 'releve' | 'gesture' | 'plie' | 'tilt' | 'turn'

export interface PhraseEvent {
  kind: EventKind
  /** Seconds; start inclusive, end exclusive. */
  start: number
  end: number
  /** Frame range [i0, i1). */
  i0: number
  i1: number
  /** Time of the peak value. */
  peakT: number
  /** Kind-specific values (numbers only, or a side / label for gestures and turns). */
  values: Record<string, number | string | null>
}

/** Hysteresis run detector on a boolean-ish signal: on when `isOn`, stays on until `isOff`. Gaps keep the state. */
export function runs(
  n: number,
  isOn: (i: number) => boolean | null,
  isOff: (i: number) => boolean | null,
  minFrames: number,
): Array<[number, number]> {
  const out: Array<[number, number]> = []
  let start = -1
  let last = -1
  for (let i = 0; i < n; i++) {
    if (start < 0) {
      if (isOn(i)) {
        start = i
        last = i
      }
    } else {
      const off = isOff(i)
      if (off === null) continue
      if (off) {
        if (last + 1 - start >= minFrames) out.push([start, last + 1])
        start = -1
      } else last = i
    }
  }
  if (start >= 0 && last + 1 - start >= minFrames) out.push([start, last + 1])
  return out
}

const nn = (v: number | null | undefined): v is number => v !== null && v !== undefined && Number.isFinite(v)

function peakOf(values: (number | null)[], i0: number, i1: number, sign = 1): number {
  let best = -1
  for (let i = i0; i < i1; i++) {
    const v = values[i]
    if (nn(v) && (best < 0 || sign * v > sign * (values[best] as number))) best = i
  }
  return best < 0 ? i0 : best
}

function medianIn(values: (number | null)[], i0: number, i1: number): number | null {
  const v: number[] = []
  for (let i = i0; i < i1; i++) if (nn(values[i])) v.push(values[i] as number)
  return median(v)
}

/** Front / side / back label of an azimuth in the pelvis frame (side = towards the working leg's own side). */
export function directionLabel(az: number | null, side: Side): string | null {
  if (az === null) return null
  const a = Math.abs(az)
  if (a <= 30) return 'front'
  if (a >= 150) return 'back'
  const own = side === 'right' ? az > 0 : az < 0
  const label = a < 60 ? (own ? 'front-side' : 'front-across') : a > 120 ? (own ? 'back-side' : 'back-across') : own ? 'side' : 'across'
  return label
}

/** Height of the working ankle against the supporting leg's landmarks. */
export function levelLabel(overKnee: number | null, overHip: number | null): string | null {
  if (overKnee === null || overHip === null) return null
  if (overHip >= -0.05) return 'hip or above'
  if (overKnee >= -0.05) return 'knee to hip'
  return 'below knee'
}

export function detectEvents(series: PoseSeries, sig: BodySignals = bodySignals(series)): PhraseEvent[] {
  const { t } = sig
  const n = t.length
  const fps = series.fps
  const frames = (s: number) => Math.max(1, Math.round(s * fps))
  const events: PhraseEvent[] = []
  const ev = (kind: EventKind, i0: number, i1: number, peak: number, values: PhraseEvent['values']) =>
    events.push({ kind, i0, i1, start: t[i0], end: i1 < n ? t[i1] : series.durationS, peakT: t[peak], values })
  const r1 = (v: number | null, k = 100) => (v === null ? null : Math.round(v * k) / k)

  // Gestures: one foot off the floor.
  for (const s of ['left', 'right'] as const) {
    const raise = sig.footRaise[s]
    const found = runs(
      n,
      (i) => nn(raise[i]) && (raise[i] as number) > GESTURE_ON,
      (i) => (nn(raise[i]) ? (raise[i] as number) < GESTURE_OFF : null),
      frames(GESTURE_MIN_S),
    )
    for (const [i0, i1] of found) {
      const p = peakOf(sig.legElev[s], i0, i1)
      const elev = sig.legElev[s][p]
      let held = 0
      if (nn(elev)) for (let i = i0; i < i1; i++) if (nn(sig.legElev[s][i]) && (sig.legElev[s][i] as number) >= elev - HOLD_BAND_DEG) held++
      const az = sig.legAz[s][p]
      const tilt = sig.hipTiltR[p]
      ev('gesture', i0, i1, p, {
        side: s,
        peak_raise_L: r1(raise[peakOf(raise, i0, i1)]),
        peak_elevation_deg: r1(elev, 1),
        direction_deg: r1(az, 1),
        direction: directionLabel(az, s),
        level: levelLabel(sig.ankleOverKnee[s][p], sig.ankleOverHip[s][p]),
        working_knee_deg: r1(sig.knee[s][p], 1),
        supporting_knee_deg: r1(sig.knee[other(s)][p], 1),
        supporting_heel_lift_L: r1(sig.heelLift[other(s)][p]),
        working_hip_above_L: r1(tilt === null ? null : s === 'right' ? tilt : -tilt),
        trunk_deg: r1(sig.trunkDeg[p], 1),
        held_s: r1(held / fps),
      })
    }
  }

  const bothDown = (i: number) => nn(sig.footRaise.left[i]) && Math.abs(sig.footRaise.left[i] as number) < BOTH_DOWN_MAX
  const straight = (i: number) =>
    nn(sig.knee.left[i]) && nn(sig.knee.right[i]) && (sig.knee.left[i] as number) < STRAIGHT_KNEE_DEG && (sig.knee.right[i] as number) < STRAIGHT_KNEE_DEG
  const minHeel = sig.heelLift.left.map((l, i) => {
    const r = sig.heelLift.right[i]
    return nn(l) && nn(r) ? Math.min(l, r) : null
  })

  // Relevés: both feet down, both heels up, knees straight.
  for (const [i0, i1] of runs(
    n,
    (i) => bothDown(i) && straight(i) && nn(minHeel[i]) && (minHeel[i] as number) > RELEVE_ON,
    (i) => (nn(minHeel[i]) ? (minHeel[i] as number) < RELEVE_OFF || !bothDown(i) || !straight(i) : null),
    frames(RELEVE_MIN_S),
  )) {
    const p = peakOf(minHeel, i0, i1)
    ev('releve', i0, i1, p, {
      peak_heel_lift_L: r1(minHeel[p]),
      median_heel_lift_L: r1(medianIn(minHeel, i0, i1)),
      trunk_deg: r1(medianIn(sig.trunkDeg, i0, i1), 1),
      duration_s: r1((i1 - i0) / fps),
    })
  }

  // Pliés: both feet down, both knees bent.
  const minKnee = sig.knee.left.map((l, i) => {
    const r = sig.knee.right[i]
    return nn(l) && nn(r) ? Math.min(l, r) : null
  })
  for (const [i0, i1] of runs(
    n,
    (i) => bothDown(i) && nn(minKnee[i]) && (minKnee[i] as number) > PLIE_KNEE_DEG,
    (i) => (nn(minKnee[i]) ? (minKnee[i] as number) < PLIE_KNEE_DEG * 0.7 || !bothDown(i) : null),
    frames(PLIE_MIN_S),
  )) {
    const p = peakOf(minKnee, i0, i1)
    ev('plie', i0, i1, p, {
      peak_knee_deg: r1(minKnee[p], 1),
      trunk_at_peak_deg: r1(sig.trunkDeg[p], 1),
      duration_s: r1((i1 - i0) / fps),
    })
  }

  // Tilts / bends.
  const trunk = sig.trunkDeg
  for (const [i0, i1] of runs(
    n,
    (i) => nn(trunk[i]) && (trunk[i] as number) > TILT_DEG,
    (i) => (nn(trunk[i]) ? (trunk[i] as number) < TILT_DEG * 0.8 : null),
    frames(TILT_MIN_S),
  )) {
    const p = peakOf(trunk, i0, i1)
    const az = sig.trunkAz[p]
    ev('tilt', i0, i1, p, {
      peak_deg: r1(trunk[p], 1),
      direction_deg: r1(az, 1),
      direction: az === null ? null : Math.abs(az) <= 45 ? 'forward' : Math.abs(az) >= 135 ? 'back' : az > 0 ? 'right' : 'left',
      knees_at_peak_deg: r1(minKnee[p], 1),
      duration_s: r1((i1 - i0) / fps),
    })
  }

  // Turns: monotonic runs of the unwrapped yaw.
  const yaw = sig.yaw
  let i = 0
  const pause = frames(TURN_PAUSE_S)
  while (i < n) {
    if (!nn(yaw[i])) {
      i++
      continue
    }
    // Find the next moving step to set a direction.
    let j = i + 1
    while (j < n && !nn(yaw[j])) j++
    if (j >= n) break
    const rate = ((yaw[j] as number) - (yaw[i] as number)) / (t[j] - t[i])
    if (Math.abs(rate) < TURN_RATE_DEG_S) {
      i = j
      continue
    }
    const dir = Math.sign(rate)
    const start = i
    let end = j
    let still = 0
    let k = j
    while (k + 1 < n) {
      let m = k + 1
      while (m < n && !nn(yaw[m])) m++
      if (m >= n) break
      const r = ((yaw[m] as number) - (yaw[k] as number)) / (t[m] - t[k])
      if (dir * r >= TURN_RATE_DEG_S) {
        end = m
        still = 0
      } else if (dir * r < -TURN_RATE_DEG_S || ++still > pause) break
      k = m
    }
    const total = (yaw[end] as number) - (yaw[start] as number)
    if (Math.abs(total) >= TURN_MIN_DEG) {
      ev('turn', start, end + 1, end, {
        degrees: r1(Math.abs(total), 1),
        direction: total > 0 ? 'positive yaw' : 'negative yaw',
        duration_s: r1(t[end] - t[start]),
      })
    }
    i = Math.max(end, i + 1)
  }

  return events.sort((a, b) => a.start - b.start || a.kind.localeCompare(b.kind))
}
