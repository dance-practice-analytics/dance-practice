// Metrics engine (FR-3.4.x, SDD 5.4–5.5): one attempt's PoseSeries in, the
// `attempt_metrics` row out. Pure functions on the world landmarks (metres, hip-centred,
// y pointing down), so values do not depend on camera distance.
//
// Rules this file keeps:
// - Values only. Nothing here scores, ranks or judges technique (FR-3.4.8).
// - A frame without tracking is a gap. It is left out of the value, it lowers the
//   confidence, and it is never interpolated or zeroed. A metric that cannot be
//   measured is null with a machine-readable reason.
// - Weak tracking is not a gap. A frame whose landmarks are visible at TRACK_MIN or more
//   is used for the value; only frames at VIS_MIN (0.6) or more count towards the
//   confidence score. Weakly tracked input therefore gives a value flagged low
//   confidence, and input that is not tracked at all gives a null.
// - One attempt per clip: values come from the first lift. When the clip holds more, each
//   value carries the clip note `multiple_lifts_detected`.

import type { Landmark, PoseSeries } from '../pose/types'
import { segmentPhases, type Segmentation } from './phases'
import { HIPS, LEG, SHOULDERS, VIS_MIN, angleDeg, meanVisibility, median, mid, seen, sub, type Side } from './signals'
import type {
  AttemptMetrics,
  ClipNote,
  ConfidenceLevel,
  MetricConfidence,
  MetricKey,
  MetricNote,
  Movement,
  NullReason,
  Phase,
} from './types'

/**
 * Bump when a definition or constant changes, so stored values can be recomputed (FR-3.4.9).
 * 1.2.0 (calibration, src/metrics/CALIBRATION.md): parallel-relevé tie on floor-referenced
 * heel lift with a 2% tolerance (was raw heel y, exact); swap jump 90° (was 135°); upstream,
 * left/right swaps undone before smoothing, world One-Euro beta 0.7, seeks 2 ms into a frame.
 */
export const ALGORITHM_VERSION = 'mt2-metrics-1.2.0'

/** Confidence bands (SDD 5.5). */
export const CONFIDENCE_HIGH = 0.8
export const CONFIDENCE_MEDIUM = 0.5
/** Tolerance band of the balance: hip speed in m/s and pelvis–ankle offset in leg lengths. */
export const BALANCE_MAX_SPEED = 0.15
export const BALANCE_MAX_OFFSET = 0.25
/**
 * Time base of the speed in the balance: displacement between the frames 0.1 s before
 * and 0.1 s after, not between neighbouring frames. The SDD says "speed" and no more.
 *
 * Evidence (real MediaPipe output of three synthetic clips): with neighbouring frames a
 * figure standing still on flat feet read 0.06–0.07 m/s at the median and over 0.15 m/s
 * in 4–15% of the frames, because 2 mm of landmark jitter per frame is 0.06 m/s at
 * 30 fps; the balance was cut into runs of 1–16 frames. Over 0.2 s the same standing
 * frames stay under 0.15 m/s in 97–100% of the frames. 0.2 s is also the longest base
 * that still reads a real sway of up to 1 Hz (the smoothing filter's cutoff) within 7%.
 */
export const SPEED_WINDOW_S = 0.2
/** Knee tracking is measured only while the knee is bent more than this. */
export const KNEE_BENT_DEG = 15
/** Below 1 cm of horizontal length a knee or foot direction is tracking noise, not a direction. */
export const MIN_DIRECTION_M = 0.01

/** Where each metric is measured (SDD 5.5, "Phases" column). */
export const METRIC_PHASES: Record<MetricKey, Phase[]> = {
  trunk_inclination_deg: ['hold', 'finish'],
  pelvis_ankle_offset_norm: ['hold', 'finish'],
  balance_duration_s: ['hold'],
  knee_tracking_dev_deg: ['prep', 'finish'],
  turn_count: ['turn'],
}

export function confidenceLevel(score: number): ConfidenceLevel {
  return score >= CONFIDENCE_HIGH ? 'high' : score >= CONFIDENCE_MEDIUM ? 'medium' : 'low'
}

interface Measured {
  value: number | null
  confidence: MetricConfidence
}

const unavailable = (key: MetricKey, reason: NullReason): Measured => ({
  value: null,
  confidence: { level: 'low', score: 0, phases: METRIC_PHASES[key], reason },
})

/**
 * `valid`: the phase frames the value is taken from (every landmark at TRACK_MIN or more).
 * `score`: the SDD confidence, unchanged: share of the phase frames in which every
 * landmark has visibility >= 0.6, times the mean visibility of those landmarks over
 * those frames. A value taken only from weaker frames has score 0 and level low.
 */
function coverage(series: PoseSeries, frames: number[], landmarks: readonly number[], skip?: (i: number) => boolean) {
  const valid: number[] = []
  let confident = 0
  let vis = 0
  for (const i of frames) {
    const w = series.frames[i].world
    if (!seen(w, landmarks)) continue
    valid.push(i)
    if (!seen(w, landmarks, VIS_MIN) || skip?.(i)) continue
    confident++
    vis += meanVisibility(w, landmarks)
  }
  const score = confident ? (confident / frames.length) * (vis / confident) : 0
  return { valid, score }
}

function framesIn(seg: Segmentation, phases: Phase[]): number[] {
  const out: number[] = []
  for (const s of seg.segments) if (phases.includes(s.phase)) for (let i = s.i0; i < s.i1; i++) out.push(i)
  return out
}

/** Median over the tracked frames of the metric's phases of a per-frame value. */
function medianMetric(
  series: PoseSeries,
  seg: Segmentation,
  key: MetricKey,
  landmarks: readonly number[],
  at: (world: Landmark[]) => number | null,
  emptyReason: NullReason = 'no_valid_frames',
): Measured {
  const frames = framesIn(seg, METRIC_PHASES[key])
  if (!frames.length) return unavailable(key, 'phase_not_found')
  const { valid, score } = coverage(series, frames, landmarks)
  if (!valid.length) return unavailable(key, 'no_valid_frames')
  const values: number[] = []
  for (const i of valid) {
    const v = at(series.frames[i].world as Landmark[])
    if (v !== null) values.push(v)
  }
  const value = median(values)
  if (value === null) return unavailable(key, emptyReason)
  return { value, confidence: { level: confidenceLevel(score), score, phases: METRIC_PHASES[key] } }
}

/** Trunk inclination: angle between hip midpoint → shoulder midpoint and straight up (0, −1, 0). */
function trunkInclination(world: Landmark[]): number | null {
  const [ls, rs] = SHOULDERS
  const [lh, rh] = HIPS
  return angleDeg(sub(mid(world[ls], world[rs]), mid(world[lh], world[rh])), { x: 0, y: -1, z: 0 })
}

/** Horizontal (x, z) vector from the supporting ankle to the hip midpoint, in metres. */
function pelvisOverAnkle(world: Landmark[], side: Side) {
  const [lh, rh] = HIPS
  const hip = mid(world[lh], world[rh])
  const ankle = world[LEG[side].ankle]
  return { x: hip.x - ankle.x, z: hip.z - ankle.z }
}

/**
 * Balance duration: longest run of consecutive hold frames inside the tolerance band,
 * divided by fps. The heel is lifted in every hold frame by construction.
 *
 * World landmarks are hip-centred, so the hip midpoint itself never moves. Its
 * horizontal speed is measured relative to the supporting ankle, the one point that
 * stays on the floor during a balance, over SPEED_WINDOW_S. An untracked frame ends the
 * run: a balance is never bridged across a gap, and neither is a speed.
 */
function balanceDuration(series: PoseSeries, seg: Segmentation, side: Side, legLen: number): Measured {
  const key: MetricKey = 'balance_duration_s'
  const frames = framesIn(seg, METRIC_PHASES[key])
  if (!frames.length) return unavailable(key, 'phase_not_found')
  const landmarks = [...HIPS, LEG[side].ankle]
  const { valid, score } = coverage(series, frames, landmarks)
  if (!valid.length) return unavailable(key, 'no_valid_frames')

  const vector = (i: number) => {
    const f = series.frames[i]
    return f && seen(f.world, landmarks) ? pelvisOverAnkle(f.world, side) : null
  }
  // Displacement between the tracked frames up to half a window before and after. The
  // reach stops at a gap, so next to one the base is shorter; a frame with a gap on both
  // sides has no speed.
  const half = Math.max(1, Math.round((SPEED_WINDOW_S / 2) * series.fps))
  const reach = (i: number, step: -1 | 1): number => {
    let j = i
    while (Math.abs(j + step - i) <= half && vector(j + step)) j += step
    return j
  }
  const speed = (i: number): number | null => {
    if (!vector(i)) return null
    const a = reach(i, -1)
    const b = reach(i, 1)
    const dt = series.frames[b].t - series.frames[a].t
    if (!(dt > 0)) return null
    const from = vector(a) as { x: number; z: number }
    const to = vector(b) as { x: number; z: number }
    return Math.hypot(to.x - from.x, to.z - from.z) / dt
  }

  let longest = 0
  let run = 0
  let last = -2
  for (const i of valid) {
    const v = vector(i) as { x: number; z: number }
    const s = speed(i)
    const steady = s !== null && s < BALANCE_MAX_SPEED && Math.hypot(v.x, v.z) / legLen < BALANCE_MAX_OFFSET
    run = steady ? (i === last + 1 ? run + 1 : 1) : 0
    if (steady) last = i
    longest = Math.max(longest, run)
  }
  // 0 is a measurement here (tracked hold, no frame inside the band), not a filled gap.
  return { value: longest / series.fps, confidence: { level: confidenceLevel(score), score, phases: METRIC_PHASES[key] } }
}

/**
 * Knee tracking deviation of the supporting leg: unsigned angle in the horizontal plane
 * between the knee direction (ankle → knee) and the foot direction (heel → toe), on the
 * frames where the knee is bent more than KNEE_BENT_DEG (180° − hip–knee–ankle angle).
 */
function kneeTracking(world: Landmark[], side: Side): number | null {
  const { hip, knee, ankle, heel, toe } = LEG[side]
  const inner = angleDeg(sub(world[hip], world[knee]), sub(world[ankle], world[knee]))
  if (inner === null || 180 - inner <= KNEE_BENT_DEG) return null
  const k = sub(world[knee], world[ankle])
  const f = sub(world[toe], world[heel])
  if (Math.hypot(k.x, k.z) < MIN_DIRECTION_M || Math.hypot(f.x, f.z) < MIN_DIRECTION_M) return null
  return angleDeg({ x: k.x, y: 0, z: k.z }, { x: f.x, y: 0, z: f.z })
}

/**
 * Turn count: |ψ(end) − ψ(start)| / 360 over the turn phase, rounded to the nearest
 * quarter, with ψ the unwrapped shoulder-line yaw. Unsigned: direction is not reported.
 */
function turnCount(series: PoseSeries, seg: Segmentation): Measured {
  const key: MetricKey = 'turn_count'
  const frames = framesIn(seg, METRIC_PHASES[key])
  if (!frames.length) return unavailable(key, 'no_turn_detected')
  const { yaw, swap } = seg.yaw
  const tracked = frames.filter((i) => yaw[i] !== null)
  if (tracked.length < 2) return unavailable(key, 'no_valid_frames')
  const first = tracked[0]
  const last = tracked[tracked.length - 1]
  const value = Math.round((Math.abs((yaw[last] as number) - (yaw[first] as number)) / 360) * 4) / 4

  // A frame whose yaw had to be repaired does not count as a usable frame.
  const { score } = coverage(series, frames, SHOULDERS, (i) => swap[i])
  const notes: MetricNote[] = []
  if (frames.some((i) => swap[i])) notes.push('left_right_swap_corrected')
  // Rotation during a gap is invisible (anything past half a turn is lost), so the
  // estimate is low confidence whatever the score says (FR-3.4.6).
  const lost = last - first + 1 > tracked.length
  if (lost) notes.push('tracking_lost_in_turn')
  const confidence: MetricConfidence = {
    level: lost ? 'low' : confidenceLevel(score),
    score,
    phases: METRIC_PHASES[key],
  }
  if (notes.length) confidence.notes = notes
  return { value, confidence }
}

export function computeMetrics(series: PoseSeries, movement: Movement): AttemptMetrics {
  const seg = segmentPhases(series, movement)
  const { frames } = series
  const n = frames.length
  // A trimmed series (FR-3.2.7) ends where the processed part ends, not at the clip's end.
  const processedEnd = series.trim ? Math.min(series.durationS, series.trim.endS) : series.durationS
  const clipEnd = n ? Math.max(processedEnd, frames[n - 1].t) : 0

  const keys = Object.keys(METRIC_PHASES) as MetricKey[]
  const out = {} as Record<MetricKey, Measured>
  const side = seg.support
  const legLen = seg.legLength

  if (seg.reason || side === null || legLen === null) {
    // No lifted part: nothing can be placed in a phase, so nothing is measured.
    for (const k of keys) out[k] = unavailable(k, seg.reason ?? 'no_leg_length')
  } else {
    const leg = LEG[side]
    out.trunk_inclination_deg = medianMetric(series, seg, 'trunk_inclination_deg', [...SHOULDERS, ...HIPS], trunkInclination)
    out.pelvis_ankle_offset_norm = medianMetric(series, seg, 'pelvis_ankle_offset_norm', [...HIPS, leg.ankle], (w) => {
      const v = pelvisOverAnkle(w, side)
      return Math.hypot(v.x, v.z) / legLen
    })
    out.balance_duration_s = balanceDuration(series, seg, side, legLen)
    out.knee_tracking_dev_deg = medianMetric(
      series,
      seg,
      'knee_tracking_dev_deg',
      [leg.hip, leg.knee, leg.ankle, leg.heel, leg.toe],
      (w) => kneeTracking(w, side),
      'knee_not_bent',
    )
    out.turn_count = turnCount(series, seg)
  }
  // Applies whatever the tracking was like.
  if (movement !== 'pirouette') out.turn_count = unavailable('turn_count', 'not_applicable')

  const confidence = {} as Record<MetricKey, MetricConfidence>
  // The clip was not split: say on every value that it describes the first of several lifts.
  const clipNotes: ClipNote[] = seg.lifts > 1 ? ['multiple_lifts_detected'] : []
  for (const k of keys) {
    confidence[k] = out[k].confidence
    if (out[k].value !== null && clipNotes.length) confidence[k].clip_notes = clipNotes
  }

  return {
    movement,
    trunk_inclination_deg: out.trunk_inclination_deg.value,
    pelvis_ankle_offset_norm: out.pelvis_ankle_offset_norm.value,
    balance_duration_s: out.balance_duration_s.value,
    knee_tracking_dev_deg: out.knee_tracking_dev_deg.value,
    turn_count: out.turn_count.value,
    phases: seg.segments.map((s) => ({
      phase: s.phase,
      start: frames[s.i0].t,
      end: s.i1 < n ? frames[s.i1].t : clipEnd,
    })),
    confidence,
    algorithm_version: ALGORITHM_VERSION,
  }
}
