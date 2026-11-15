// What the timelines draw, straight from the PoseSeries: where tracking is missing or
// weak (hatched bands) and per-frame traces that break at every gap. Pure functions —
// nothing here interpolates, fills or smooths; a frame without a pose stays a hole.

import { LM, type Landmark, type PoseFrame, type PoseSeries } from '../../../pose/types'

/** Same threshold as the metrics engine and the stage: below it a landmark is weakly seen. */
export const LOW_VISIBILITY = 0.6

/** The joints the measurements use; their mean visibility is the frame's tracking level. */
export const BODY_LANDMARKS: readonly number[] = [
  LM.leftShoulder,
  LM.rightShoulder,
  LM.leftHip,
  LM.rightHip,
  LM.leftKnee,
  LM.rightKnee,
  LM.leftAnkle,
  LM.rightAnkle,
  LM.leftHeel,
  LM.rightHeel,
  LM.leftFootIndex,
  LM.rightFootIndex,
]

const TRUNK: readonly number[] = [LM.leftShoulder, LM.rightShoulder, LM.leftHip, LM.rightHip]

/** Mean visibility of the body joints in a frame; null when the frame has no pose. */
export function frameVisibility(frame: PoseFrame | null | undefined): number | null {
  const lm = frame?.image
  if (!lm) return null
  let sum = 0
  for (const i of BODY_LANDMARKS) sum += lm[i]?.visibility ?? 0
  return sum / BODY_LANDMARKS.length
}

// ---------- hatched bands ----------

export type BandKind = 'gap' | 'low'

export interface Band {
  /** 'gap' = no pose in these frames; 'low' = a pose with mean visibility under the threshold. */
  kind: BandKind
  /** Seconds; `end` is where the next frame starts (or the end of the clip). */
  start: number
  end: number
  frames: number
}

/** End of the clip on the time axis: the stated duration, or the end of the last frame. */
export function seriesEnd(series: PoseSeries): number {
  const n = series.frames.length
  if (!n) return Math.max(0, series.durationS)
  const step = series.fps > 0 ? 1 / series.fps : 0
  return Math.max(series.durationS, series.frames[n - 1].t + step)
}

/**
 * Runs of consecutive frames without tracking ('gap') or with weak tracking ('low').
 * A single frame makes a band; neighbouring runs are never merged across tracked frames.
 */
export function trackingBands(series: PoseSeries, lowBelow = LOW_VISIBILITY): Band[] {
  const { frames } = series
  const end = seriesEnd(series)
  const bands: Band[] = []
  let kind: BandKind | null = null
  let i0 = 0
  const close = (i1: number) => {
    if (kind) bands.push({ kind, start: frames[i0].t, end: i1 < frames.length ? frames[i1].t : end, frames: i1 - i0 })
  }
  for (let i = 0; i < frames.length; i++) {
    const v = frameVisibility(frames[i])
    const k: BandKind | null = v === null ? 'gap' : v < lowBelow ? 'low' : null
    if (k !== kind) {
      close(i)
      kind = k
      i0 = i
    }
  }
  close(frames.length)
  return bands
}

export interface BandCount {
  gapFrames: number
  lowFrames: number
  totalFrames: number
}

export function countBands(series: PoseSeries, bands: readonly Band[]): BandCount {
  let gapFrames = 0
  let lowFrames = 0
  for (const b of bands) {
    if (b.kind === 'gap') gapFrames += b.frames
    else lowFrames += b.frames
  }
  return { gapFrames, lowFrames, totalFrames: series.frames.length }
}

// ---------- per-frame values ----------

export interface FrameValue {
  v: number
  /** True when a landmark the value needs is under the visibility threshold: drawn dashed. */
  low: boolean
}

export type FrameReader = (frame: PoseFrame) => FrameValue | null

/** Mean body visibility of the frame (0..1). */
export const visibilityAt: FrameReader = (frame) => {
  const v = frameVisibility(frame)
  return v === null ? null : { v, low: v < LOW_VISIBILITY }
}

const mid = (a: Landmark, b: Landmark) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 })

/**
 * Trunk inclination of one frame: the angle between the hip midpoint → shoulder midpoint
 * line and straight up, in degrees, on the world landmarks (y points down). The same
 * definition as the stored metric (src/metrics/engine.ts), which is its median over a phase.
 */
export const trunkAt: FrameReader = (frame) => {
  const w = frame.world
  if (!w) return null
  const s = mid(w[LM.leftShoulder], w[LM.rightShoulder])
  const h = mid(w[LM.leftHip], w[LM.rightHip])
  const d = { x: s.x - h.x, y: s.y - h.y, z: s.z - h.z }
  const len = Math.hypot(d.x, d.y, d.z)
  if (!(len > 0)) return null
  const v = (Math.acos(Math.min(1, Math.max(-1, -d.y / len))) * 180) / Math.PI
  return { v, low: TRUNK.some((i) => !(w[i].visibility >= LOW_VISIBILITY)) }
}

// ---------- traces ----------

export interface TracePoint {
  t: number
  v: number
}

export interface TraceSegment {
  /** 'dashed' = values from weakly seen landmarks. */
  kind: 'solid' | 'dashed'
  points: TracePoint[]
}

/**
 * A per-frame value as line segments. A frame without a value ends the segment (the line
 * is not drawn across it); a change between well and weakly seen starts a new segment
 * that shares the boundary point, so the line stays connected where tracking exists.
 * Clips longer than `maxPoints` frames are drawn one point per bucket of frames; a
 * bucket with any missing frame is a hole.
 */
export function buildTrace(series: PoseSeries, read: FrameReader, maxPoints = 2000): TraceSegment[] {
  const { frames } = series
  const bucket = Math.max(1, Math.ceil(frames.length / maxPoints))
  const segments: TraceSegment[] = []
  let current: TraceSegment | null = null
  let prev: TracePoint | null = null
  for (let i = 0; i < frames.length; i += bucket) {
    let sum = 0
    let n = 0
    let low = false
    let hole = false
    for (let j = i; j < Math.min(frames.length, i + bucket); j++) {
      const r = read(frames[j])
      if (!r) {
        hole = true
        break
      }
      sum += r.v
      n++
      low ||= r.low
    }
    if (hole || n === 0) {
      current = null
      prev = null
      continue
    }
    const point = { t: frames[i].t, v: sum / n }
    const kind = low ? 'dashed' : 'solid'
    if (!current || current.kind !== kind) {
      current = { kind, points: prev ? [prev] : [] }
      segments.push(current)
    }
    current.points.push(point)
    prev = point
  }
  return segments
}

/** Largest value of a trace; null when it has no points. */
export function traceMax(segments: readonly TraceSegment[]): number | null {
  let max: number | null = null
  for (const s of segments) for (const p of s.points) if (max === null || p.v > max) max = p.v
  return max
}

/** Axis top for degrees: the next multiple of 5 above the data, at least 10. */
export function niceMax(max: number | null, floor = 10, step = 5): number {
  if (max === null || !(max > 0)) return floor
  return Math.max(floor, Math.ceil(max / step) * step)
}

/**
 * `points` attribute of an SVG polyline in a `width` × `height` box with 4px of head and
 * foot room. `mapT` places a point on another clock (Compare draws B on A's time axis).
 */
export function polylinePoints(
  segment: TraceSegment,
  duration: number,
  max: number,
  width: number,
  height: number,
  mapT: (t: number) => number = (t) => t,
): string {
  if (!(duration > 0) || !(max > 0)) return ''
  const pad = 4
  return segment.points
    .map((p) => {
      const x = (mapT(p.t) / duration) * width
      const y = height - pad - Math.min(1, Math.max(0, p.v / max)) * (height - 2 * pad)
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
}

/** Left edge and width of a span on a time axis, as CSS percentages. */
export function spanStyle(start: number, end: number, duration: number): { left: string; width: string } {
  if (!(duration > 0)) return { left: '0%', width: '0%' }
  const a = Math.min(1, Math.max(0, start / duration))
  const b = Math.min(1, Math.max(0, end / duration))
  return { left: `${(a * 100).toFixed(3)}%`, width: `${(Math.max(0, b - a) * 100).toFixed(3)}%` }
}
