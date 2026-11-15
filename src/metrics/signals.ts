// Per-frame signals read from the world landmarks. A frame only yields a value when
// every landmark it needs is tracked; otherwise the signal is null (a gap). Nothing
// here interpolates, fills or zeroes.
//
// Two visibility levels are kept apart (since mt2-metrics-1.1.0):
// - TRACK_MIN decides whether a landmark is there at all. Below it the frame is a gap.
// - VIS_MIN (the SDD's 0.6) decides whether a frame counts towards the confidence score.
// A landmark between the two is used for the value and lowers the confidence, so weak
// tracking shows up as a low-confidence value and absent tracking stays a null.

import { LM, type Landmark, type PoseSeries } from '../pose/types'

/** A frame counts towards the confidence score when every landmark is at or above this (SDD 5.5). */
export const VIS_MIN = 0.6

/**
 * A landmark is used at or above this visibility; below it the frame is a gap.
 *
 * Evidence (three synthetic front-view clips, 3510 frames of real MediaPipe output, a
 * pose in every frame): hips and shoulders read 1.00, but the foot index reads 0.27–0.70
 * (median 0.55 left, 0.47 right) and the ankle and knee medians fall to 0.45–0.57 while
 * the heels are lifted. With the single 0.6 gate the left toe passed in 25% of the
 * frames and the right in 0.6%, so there was no floor level and no phase. The positions
 * behind those visibilities are usable: the median heel-above-toe of frames with toe
 * visibility under 0.5 is within 0.5 cm of the frames above 0.5 while standing and
 * within 1.4 cm while lifted (a lift is 4–8 cm). After the first 0.5 s, 0.3 keeps every
 * frame of ankles, heels and toes and 99.5% of the weakest knee.
 *
 * Not measured: how low MediaPipe goes for a foot that is really out of frame or hidden.
 * Those clips have none, so 0.3 is a floor for "the model placed it", not a tested limit.
 */
export const TRACK_MIN = 0.3

/** A one-frame yaw jump larger than this is a left/right label swap, not a rotation
 *  (it is closer to 180° than to a quarter turn; at 30 fps it would be over 11 turns/s). */
export const SWAP_JUMP_DEG = 135

export type Side = 'left' | 'right'

export const LEG = {
  left: { hip: LM.leftHip, knee: LM.leftKnee, ankle: LM.leftAnkle, heel: LM.leftHeel, toe: LM.leftFootIndex },
  right: { hip: LM.rightHip, knee: LM.rightKnee, ankle: LM.rightAnkle, heel: LM.rightHeel, toe: LM.rightFootIndex },
} as const

export const SHOULDERS = [LM.leftShoulder, LM.rightShoulder] as const
export const HIPS = [LM.leftHip, LM.rightHip] as const

const DEG = 180 / Math.PI

/**
 * True when the frame has a pose and every listed landmark is at or above `min`:
 * TRACK_MIN (the default) to use the frame, VIS_MIN to count it as confidently tracked.
 */
export function seen(world: Landmark[] | null, idx: readonly number[], min: number = TRACK_MIN): world is Landmark[] {
  if (!world) return false
  for (const i of idx) {
    const p = world[i]
    if (!p || !(p.visibility >= min)) return false
  }
  return true
}

export function meanVisibility(world: Landmark[], idx: readonly number[]): number {
  let sum = 0
  for (const i of idx) sum += world[i].visibility
  return idx.length ? sum / idx.length : 0
}

export function median(values: number[]): number | null {
  if (!values.length) return null
  const s = [...values].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

export interface Vec3 {
  x: number
  y: number
  z: number
}

export const mid = (a: Vec3, b: Vec3): Vec3 => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 })
export const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z })
export const norm = (v: Vec3): number => Math.hypot(v.x, v.y, v.z)

/** Angle between two vectors in degrees (0..180); null when either has no length. */
export function angleDeg(a: Vec3, b: Vec3): number | null {
  const d = norm(a) * norm(b)
  if (!(d > 0)) return null
  return Math.acos(Math.min(1, Math.max(-1, (a.x * b.x + a.y * b.y + a.z * b.z) / d))) * DEG
}

/**
 * Leg length |hip − knee| + |knee − ankle| in metres, as the median over every frame
 * where the three joints are tracked. One value per clip: segment lengths do not change,
 * so the median removes per-frame depth noise from every ratio that uses it.
 */
export function legLength(series: PoseSeries, side: Side): number | null {
  const { hip, knee, ankle } = LEG[side]
  const lengths: number[] = []
  for (const f of series.frames) {
    if (!seen(f.world, [hip, knee, ankle])) continue
    lengths.push(norm(sub(f.world[hip], f.world[knee])) + norm(sub(f.world[knee], f.world[ankle])))
  }
  const m = median(lengths)
  return m !== null && m > 0 ? m : null
}

/**
 * Heel height above the toe of the same foot, in metres (positive = heel higher).
 * World landmarks are hip-centred, so the floor is not at a fixed y: when the dancer
 * rises, the hip-to-heel distance barely changes while the toe (which stays on the
 * floor) moves away from the hip. The toe is therefore the floor reference.
 */
export function heelAboveToe(series: PoseSeries, side: Side): (number | null)[] {
  const { heel, toe } = LEG[side]
  return series.frames.map((f) => (seen(f.world, [heel, toe]) ? f.world[toe].y - f.world[heel].y : null))
}

export interface YawSignal {
  /** Shoulder-line yaw ψ = atan2(zR − zL, xR − xL) in degrees, unwrapped; null on gaps. */
  yaw: (number | null)[]
  /** Yaw rate in °/s from the previous tracked frame; null on gaps and on the first tracked frame. */
  rate: (number | null)[]
  /** Index of the previous tracked frame the rate was measured from. */
  from: (number | null)[]
  /** True where a left/right swap was undone. */
  swap: boolean[]
}

export function shoulderYaw(series: PoseSeries): YawSignal {
  const n = series.frames.length
  const out: YawSignal = {
    yaw: new Array<number | null>(n).fill(null),
    rate: new Array<number | null>(n).fill(null),
    from: new Array<number | null>(n).fill(null),
    swap: new Array<boolean>(n).fill(false),
  }
  let prev = -1
  let prevRaw = 0
  for (let i = 0; i < n; i++) {
    const f = series.frames[i]
    if (!seen(f.world, SHOULDERS)) continue
    const l = f.world[LM.leftShoulder]
    const r = f.world[LM.rightShoulder]
    const raw = Math.atan2(r.z - l.z, r.x - l.x) * DEG
    if (prev < 0) {
      out.yaw[i] = raw
    } else {
      // Shortest signed step, in (−180, 180].
      let d = raw - prevRaw
      d -= 360 * Math.round(d / 360)
      // Only a jump between adjacent frames can be told apart from real rotation.
      if (prev === i - 1 && Math.abs(d) > SWAP_JUMP_DEG) {
        d -= Math.sign(d) * 180
        out.swap[i] = true
      }
      out.yaw[i] = (out.yaw[prev] as number) + d
      const dt = f.t - series.frames[prev].t
      out.rate[i] = dt > 0 ? d / dt : null
      out.from[i] = prev
    }
    prev = i
    prevRaw = raw
  }
  return out
}
