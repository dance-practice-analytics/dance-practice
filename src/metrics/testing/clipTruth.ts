// Ground truth for the synthetic test clips in public/clips (npm run clips) and the
// end-to-end calibration run (scripts/calibrate-metrics.mjs). Test support only.
//
// The clips are drawn from a 2D pose track (src/mock/syntheticSession.ts), smoothed for
// the camera (src/mock/footage.ts `cameraPoses`), front view, orthographic. The truth
// here is computed from exactly the points that were drawn, with the SDD definitions
// applied in the picture plane:
// - the figure is flat, so its real depth offsets are 0 and horizontal = picture x;
// - every value is a ratio or an angle, so the drawing scale does not matter;
// - phases use the engine's own state machine (detectLift, riseEnd) on the noise-free
//   heel signal, so a phase difference measures the tracker and the smoothing, not a
//   change of definition.
// No real footage or participant data is involved.

import type { Keypoint, Point } from '../../types'
import { cameraPoses } from '../../mock/footage'
import { buildPoseTrack, plannedAttempts } from '../../mock/syntheticSession'
import { detectLift, FINISH_S, FLOOR_SKIP_S, FLOOR_WINDOW_S, riseEnd } from '../phases'

type Pts = Record<Keypoint, Point>

const DEG = 180 / Math.PI
const mid = (a: Point, b: Point): Point => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
const dist = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1])

export interface AttemptWindow {
  /** Attempt number in the clip, 1-based. */
  index: number
  /** Frame range of the slice handed to the engine: 1 s of standing before the attempt to 1 s after. */
  i0: number
  i1: number
  /** Planned phase times of the generator, seconds from the start of the slice. */
  planned: { prep: number; rise: number; hold: number; release: number; end: number }
}

export interface ClipTruth {
  fps: number
  frames: Pts[]
  attempts: AttemptWindow[]
}

export function clipTruth(seed: number, variation: number): ClipTruth {
  const track = buildPoseTrack({ seed, variation })
  const frames = cameraPoses(track.pose)
  const fps = 30
  const attempts = plannedAttempts({ seed, variation }).map((a, k) => {
    const i0 = Math.max(0, Math.round((a.start - 1) * fps))
    const i1 = Math.min(frames.length, Math.round((a.end + 1) * fps))
    const t0 = i0 / fps
    const at = (id: string) => (a.phases.find((p) => p.id === id) as { start: number }).start - t0
    return {
      index: k + 1,
      i0,
      i1,
      planned: { prep: at('prep'), rise: at('rise'), hold: at('hold'), release: at('release'), end: a.phases[3].end - t0 },
    }
  })
  return { fps, frames, attempts }
}

/** Unsigned angle of hip midpoint → shoulder midpoint from vertical, degrees (picture plane). */
export const trunkDeg = (p: Pts) => Math.abs(trunkSignedDeg(p))
/** Signed: positive when the shoulders are towards +x (the dancer's left). */
export function trunkSignedDeg(p: Pts) {
  const s = mid(p.leftShoulder, p.rightShoulder)
  const h = mid(p.leftHip, p.rightHip)
  return Math.atan2(s[0] - h[0], s[1] - h[1]) * DEG
}

export const legLength2D = (p: Pts, side: 'left' | 'right') =>
  dist(p[`${side}Hip`], p[`${side}Knee`]) + dist(p[`${side}Knee`], p[`${side}Ankle`])

/** Horizontal distance of the hip midpoint from the ankle, over leg length. */
export function pelvisOffset(p: Pts, side: 'left' | 'right', leg: number) {
  return Math.abs(mid(p.leftHip, p.rightHip)[0] - p[`${side}Ankle`][0]) / leg
}

/** Knee flexion (180° − hip–knee–ankle angle) in the picture, degrees. */
export function kneeFlexion2D(p: Pts, side: 'left' | 'right') {
  const a = p[`${side}Hip`]
  const k = p[`${side}Knee`]
  const c = p[`${side}Ankle`]
  const u = [a[0] - k[0], a[1] - k[1]]
  const v = [c[0] - k[0], c[1] - k[1]]
  const cos = (u[0] * v[0] + u[1] * v[1]) / (Math.hypot(u[0], u[1]) * Math.hypot(v[0], v[1]))
  return 180 - Math.acos(Math.max(-1, Math.min(1, cos))) * DEG
}

const median = (xs: number[]) => {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

export interface SliceTruth {
  /** Phase frame indices within the slice from the noise-free heel signal (SDD definitions). */
  onset: number
  holdStart: number
  end: number
  finishEnd: number
  legLength: number
  /** Balance duration by definition: the whole hold, since the drawn sway never leaves
   *  the band (checked: `maxSwaySpeed`, `maxOffset`). */
  balanceS: number
  /** Largest horizontal speed of the hip midpoint over the supporting ankle in the hold,
   *  in leg lengths per second, and the largest offset. */
  maxSwaySpeed: number
  maxOffset: number
}

/** Phases and balance of one attempt slice from the drawn points, as the SDD defines them. */
export function sliceTruth(frames: Pts[], fps: number): SliceTruth {
  // Heel height above its own toe, relative to the standing level of the floor window, in
  // leg lengths. In the picture y points up, so the heel is above the toe when y is larger.
  const leg = median(frames.map((p) => legLength2D(p, 'left'))) as number
  const raw = frames.map((p) => p.leftHeel[1] - p.leftToe[1])
  const window = Math.min(frames.length, Math.round(FLOOR_WINDOW_S * fps))
  const w0 = Math.max(0, Math.min(Math.round(FLOOR_SKIP_S * fps), frames.length - window))
  const floor = median(raw.slice(w0, w0 + window)) as number
  const lift = raw.map((v) => (v - floor) / leg)
  const found = detectLift(lift)
  if (!found) throw new Error('The synthetic attempt has no lift: the clip generator changed.')
  const t = frames.map((_, i) => i / fps)
  const holdStart = riseEnd(lift, t, found.onset, found.end)
  let maxSwaySpeed = 0
  let maxOffset = 0
  const half = Math.round(0.1 * fps)
  for (let i = holdStart; i < found.end; i++) {
    maxOffset = Math.max(maxOffset, pelvisOffset(frames[i], 'left', leg))
    const a = Math.max(0, i - half)
    const b = Math.min(frames.length - 1, i + half)
    const x = (j: number) => mid(frames[j].leftHip, frames[j].rightHip)[0] - frames[j].leftAnkle[0]
    maxSwaySpeed = Math.max(maxSwaySpeed, Math.abs(x(b) - x(a)) / leg / ((b - a) / fps))
  }
  return {
    onset: found.onset,
    holdStart,
    end: found.end,
    finishEnd: Math.min(frames.length, found.end + Math.round(FINISH_S * fps)),
    legLength: leg,
    balanceS: (found.end - holdStart) / fps,
    maxSwaySpeed,
    maxOffset,
  }
}

/** Truth of a per-frame value as the median over a set of frame indices. */
export function medianOver(frames: Pts[], indices: number[], value: (p: Pts) => number): number | null {
  return median(indices.map((i) => value(frames[i])))
}
