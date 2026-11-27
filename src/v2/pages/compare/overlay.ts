// Compare, Overlay mode (mentor review, task 15): A's layer (video + skeleton) drawn over
// B's with an adjustable transparency, and an optional "line up the bodies" transform that
// moves and scales A's whole layer so its body sits where B's does.
//
// The transform is one fixed move per clip pair, from medians over the well-tracked frames
// (never per frame), so A's own motion is shown unchanged: only where it stands in the
// picture and how big it appears are matched. Nothing is measured here and nothing is graded.

import { LM, type Landmark, type PoseSeries } from '../../../pose/types'

/** Same gate as the metrics engine's confidence: a landmark counts from this visibility. */
const SEEN = 0.6
/** Aspect ratios further apart than this can't be stacked point for point. */
const ASPECT_TOLERANCE = 0.01
/** Guard against a bad median: A is never scaled beyond this range. */
export const SCALE_MIN = 0.5
export const SCALE_MAX = 2

export interface BodyAnchor {
  /** Hip midpoint, normalized to the frame (0..1, origin top-left). */
  x: number
  y: number
  /** Hip-midpoint to shoulder-midpoint length, in frame widths (aspect-corrected). */
  torso: number
  /** Frames the medians came from. */
  frames: number
}

export interface LayerTransform {
  /** Translation in fractions of the stage (CSS translate %, / 100). */
  tx: number
  ty: number
  /** Uniform scale about the stage's top-left corner. */
  scale: number
}

export type MatchUnavailable = 'no_pose_a' | 'no_pose_b' | 'different_shape'

function median(xs: number[]): number {
  const s = [...xs].sort((p, q) => p - q)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

function seen(lm: Landmark[], ...idx: number[]): boolean {
  return idx.every((i) => lm[i] && lm[i].visibility >= SEEN)
}

/** Where the body stands in the picture and how big it appears, as medians over the clip. Null without a well-tracked frame. */
export function bodyAnchor(series: PoseSeries | null): BodyAnchor | null {
  if (!series || !(series.width > 0) || !(series.height > 0)) return null
  const aspect = series.height / series.width
  const xs: number[] = []
  const ys: number[] = []
  const torsos: number[] = []
  for (const f of series.frames) {
    const lm = f.image
    if (!lm || !seen(lm, LM.leftHip, LM.rightHip, LM.leftShoulder, LM.rightShoulder)) continue
    const hx = (lm[LM.leftHip].x + lm[LM.rightHip].x) / 2
    const hy = (lm[LM.leftHip].y + lm[LM.rightHip].y) / 2
    const sx = (lm[LM.leftShoulder].x + lm[LM.rightShoulder].x) / 2
    const sy = (lm[LM.leftShoulder].y + lm[LM.rightShoulder].y) / 2
    const torso = Math.hypot(sx - hx, (sy - hy) * aspect)
    if (!(torso > 0)) continue
    xs.push(hx)
    ys.push(hy)
    torsos.push(torso)
  }
  if (xs.length === 0) return null
  return { x: median(xs), y: median(ys), torso: median(torsos), frames: xs.length }
}

/**
 * The move that puts A's body on B's: A's hip midpoint lands on B's and A's torso takes B's
 * length. Only for clips of the same shape (aspect ratio), so both fill the same stage.
 */
export function matchTransform(a: PoseSeries | null, b: PoseSeries | null): LayerTransform | MatchUnavailable {
  if (a && b && a.width > 0 && b.width > 0 && Math.abs(a.height / a.width - b.height / b.width) > ASPECT_TOLERANCE) return 'different_shape'
  const pa = bodyAnchor(a)
  if (!pa) return 'no_pose_a'
  const pb = bodyAnchor(b)
  if (!pb) return 'no_pose_b'
  const scale = Math.min(SCALE_MAX, Math.max(SCALE_MIN, pb.torso / pa.torso))
  return { tx: pb.x - scale * pa.x, ty: pb.y - scale * pa.y, scale }
}

export const IDENTITY: LayerTransform = { tx: 0, ty: 0, scale: 1 }

/** CSS for A's layer (with transform-origin 0 0). */
export function transformCss(t: LayerTransform): string {
  const pct = (v: number) => `${Math.round(v * 10000) / 100}%`
  return `translate(${pct(t.tx)}, ${pct(t.ty)}) scale(${Math.round(t.scale * 1000) / 1000})`
}

export const MATCH_UNAVAILABLE_TEXT: Record<MatchUnavailable, string> = {
  no_pose_a: 'A has no well-tracked frame to line up from.',
  no_pose_b: 'B has no well-tracked frame to line up to.',
  different_shape: 'The two clips have different shapes (for example one is vertical), so they can only be blended as they are.',
}

/** The blend as words, for the slider's value text. Both skeletons stay drawn at every value. */
export function blendText(opacity: number): string {
  const pct = Math.round(opacity * 100)
  if (pct <= 0) return 'B’s video only'
  if (pct >= 100) return 'A’s video only'
  return `A’s video at ${pct}% over B’s`
}
