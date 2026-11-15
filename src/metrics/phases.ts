// Phase segmentation (FR-3.4.1, SDD 5.4): a small state machine on the supporting
// heel's height above the floor, with hysteresis so the phases do not flicker.
//
// One attempt per clip: the phases describe the FIRST lift. A clip with several lifts is
// not split here; later lifts fall in `recovery` and are only counted (`lifts`), so the
// result can say that it describes the first of several.

import type { PoseSeries } from '../pose/types'
import { LEG, heelAboveToe, legLength, median, seen, shoulderYaw, type Side, type YawSignal } from './signals'
import type { Movement, NullReason, Phase } from './types'

/** Lift starts when the heel is more than this share of leg length above the floor... */
export const LIFT_ON = 0.02
/** ...for this many consecutive tracked frames... */
export const LIFT_ON_FRAMES = 3
/** ...and ends when it drops below this share (hysteresis). */
export const LIFT_OFF = 0.01
/**
 * The floor level is taken from a 0.5 s window that starts 0.5 s into the clip.
 *
 * The SDD takes the first 0.5 s. On real MediaPipe output those frames are the tracker
 * settling: in all three synthetic test clips the heel-above-toe signal starts 4.6–6.9%
 * of leg length below its standing level and needs 17–24 frames (0.57–0.8 s) to come
 * within 0.5% of it (the image landmarks move with it, so it is in the pose data, not in
 * this engine). A floor from frames 0–14 sat 2.5–5.0% too low, and the figure standing
 * still then read as lifted (over 2%) for the 107–142 frames up to its first plié. The
 * median of 0.5–1.0 s is within 0.8% of the standing level, and with it the standing
 * figure never reads above 1.7%. A longer window (0.5–1.5 s) was no better (1.5%).
 */
export const FLOOR_SKIP_S = 0.5
export const FLOOR_WINDOW_S = 0.5
/** Finish lasts 0.5 s after the heel lands. */
export const FINISH_S = 0.5
/** "Vertical heel velocity near zero": the rise ends when the heel climbs slower than
 *  5% of leg length per second (about 4 cm/s). The SDD gives no number; this is the choice.
 *  Checked on real MediaPipe output (three synthetic clips) and kept: the supporting heel
 *  climbs at 6–20% per second during the rise, and the hold starts between 0.14 s before
 *  and 0.07 s after the moment the clip generator ends its rise. Asking for 3 slow frames
 *  in a row was tried and put it 0.07–0.13 s after that moment: no closer, so not adopted. */
export const RISE_END_RATE = 0.05
/** Shoulder-line yaw rate above which lifted frames of a pirouette are the turn. */
export const TURN_RATE_DEG_S = 90

/** Frame range [i0, i1). */
export interface Segment {
  phase: Phase
  i0: number
  i1: number
}

export interface Segmentation {
  segments: Segment[]
  /** Leg whose heel is lowest while lifted; null when there is no lift. */
  support: Side | null
  /** Supporting leg length in metres. */
  legLength: number | null
  /** Supporting heel lift per frame, as a share of leg length; null on gaps. */
  lift: (number | null)[]
  /** Lifts found in the whole clip. The segments describe the first one only. */
  lifts: number
  yaw: YawSignal
  /** Set when no lifted part could be found; every phase-based metric is then null. */
  reason: NullReason | null
}

/**
 * First lift in the signal. Down → up needs LIFT_ON_FRAMES consecutive tracked frames
 * above LIFT_ON (onset = the first of them); up → down happens on the first frame below
 * LIFT_OFF. A gap keeps the current state and breaks a run of consecutive frames: the
 * machine never assumes what happened while tracking was lost.
 */
export function detectLift(lift: (number | null)[], from = 0): { onset: number; end: number } | null {
  let run = 0
  let onset = -1
  for (let i = from; i < lift.length; i++) {
    const v = lift[i]
    if (v === null) {
      run = 0
      continue
    }
    if (onset < 0) {
      run = v > LIFT_ON ? run + 1 : 0
      if (run >= LIFT_ON_FRAMES) onset = i - LIFT_ON_FRAMES + 1
    } else if (v < LIFT_OFF) {
      return { onset, end: i }
    }
  }
  // Still lifted when the clip ends.
  return onset < 0 ? null : { onset, end: lift.length }
}

/** Number of separate lifts in the signal (the same state machine, restarted after each landing). */
export function countLifts(lift: (number | null)[]): number {
  let count = 0
  for (let found = detectLift(lift); found; found = detectLift(lift, found.end)) count++
  return count
}

export function segmentPhases(series: PoseSeries, movement: Movement): Segmentation {
  const { frames, fps } = series
  const n = frames.length
  const yaw = shoulderYaw(series)
  const none = (reason: NullReason, segments: Segment[] = []): Segmentation => ({
    segments,
    support: null,
    legLength: null,
    lift: new Array<number | null>(n).fill(null),
    lifts: 0,
    yaw,
    reason,
  })

  if (!frames.some((f) => f.world)) return none('no_pose')

  const raw = { left: heelAboveToe(series, 'left'), right: heelAboveToe(series, 'right') }
  const leg = { left: legLength(series, 'left'), right: legLength(series, 'right') }
  if (leg.left === null && leg.right === null) return none('no_leg_length')

  // Floor level: median heel height over the floor window (counted in frames so the
  // window does not depend on float timestamps; a clip shorter than the skip uses its
  // last frames). Each foot has its own level. The SDD pools both feet, but MediaPipe
  // gives each foot its own standing offset: in the three synthetic test clips the left
  // heel stands 0.7% of leg length above its toe and the right 2.7%, in every clip. That
  // difference is the size of the lift threshold itself; pooled, one foot would stand at
  // −1% and the other at +1% before anything moves.
  const window = Math.min(n, Math.max(1, Math.round(FLOOR_WINDOW_S * fps)))
  const w0 = Math.max(0, Math.min(Math.round(FLOOR_SKIP_S * fps), n - window))
  const floorOf = (s: Side): number | null => {
    const standing: number[] = []
    for (let i = w0; i < w0 + window; i++) if (raw[s][i] !== null) standing.push(raw[s][i] as number)
    return median(standing)
  }
  const floor = { left: floorOf('left'), right: floorOf('right') }
  if (floor.left === null && floor.right === null) return none('no_floor_reference')

  const liftOf = (s: Side): (number | null)[] => {
    const len = leg[s]
    const level = floor[s]
    return raw[s].map((v) => (v === null || len === null || level === null ? null : (v - level) / len))
  }
  const lift = { left: liftOf('left'), right: liftOf('right') }

  // The supporting leg is defined by the hold, and the hold by the supporting heel.
  // Break the circle in two passes: find the lifted part from whichever heel is higher,
  // pick the leg whose heel is lowest there (largest y, since y points down), then run
  // the state machine again on that heel alone.
  const either = lift.left.map((l, i) => {
    const r = lift.right[i]
    return l === null ? r : r === null ? l : Math.max(l, r)
  })
  const prepOnly: Segment[] = [{ phase: 'prep', i0: 0, i1: n }]
  const rough = detectLift(either)
  if (!rough) return none('no_lift_detected', prepOnly)

  const heelY = (s: Side): number | null => {
    const ys: number[] = []
    for (let i = rough.onset; i < rough.end; i++) {
      const w = frames[i].world
      if (seen(w, [LEG[s].heel])) ys.push(w[LEG[s].heel].y)
    }
    return median(ys)
  }
  // A foot without a floor level or a leg length has no lift signal and cannot support.
  const usable = (s: Side) => floor[s] !== null && leg[s] !== null
  const yl = usable('left') ? heelY('left') : null
  const yr = usable('right') ? heelY('right') : null
  // A tie (both heels up, as in a parallel relevé) goes to the left leg.
  const support: Side = !usable('left') ? 'right' : yr === null || (yl !== null && yl >= yr) ? 'left' : 'right'
  const signal = lift[support]
  const lifted = detectLift(signal)
  if (!lifted) return none('no_lift_detected', prepOnly)
  const { onset, end } = lifted

  // Rise ends at the first lifted frame whose forward heel velocity is near zero.
  let holdStart = end
  for (let i = onset; i < end - 1; i++) {
    const a = signal[i]
    const b = signal[i + 1]
    const dt = frames[i + 1].t - frames[i].t
    if (a === null || b === null || !(dt > 0)) continue
    if ((b - a) / dt < RISE_END_RATE) {
      holdStart = i
      break
    }
  }

  // Pirouette: the turn runs from the first to the last lifted frame that rotates faster
  // than the threshold, starting at the frame that rotation was measured from.
  let turnStart = -1
  let turnEnd = -1
  if (movement === 'pirouette') {
    for (let i = onset; i < end; i++) {
      const rate = yaw.rate[i]
      if (rate === null || Math.abs(rate) <= TURN_RATE_DEG_S) continue
      if (turnStart < 0) turnStart = Math.max(onset, yaw.from[i] as number)
      turnEnd = i + 1
    }
  }

  const finishEnd = Math.min(n, end + Math.round(FINISH_S * fps))
  const segments: Segment[] = []
  const push = (phase: Phase, i0: number, i1: number) => {
    if (i1 > i0) segments.push({ phase, i0, i1 })
  }
  push('prep', 0, onset)
  if (turnStart < 0) {
    push('rise', onset, holdStart)
    push('hold', holdStart, end)
  } else {
    // Lifted frames around the turn: rise before it until the heel settles, hold otherwise.
    push('rise', onset, Math.min(holdStart, turnStart))
    push('hold', holdStart, turnStart)
    push('turn', turnStart, turnEnd)
    push('hold', turnEnd, end)
  }
  push('finish', end, finishEnd)
  push('recovery', finishEnd, n)

  return { segments, support, legLength: leg[support], lift: signal, lifts: countLifts(signal), yaw, reason: null }
}
