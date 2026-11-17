// The one pose an attempt thumbnail shows, picked from the saved keypoints. Pure, so it
// can be tested without Storage. Only real tracked frames are used: when nothing was
// tracked there is no pose (the tile stays a plain dark box), never a made-up one.

import type { PhaseSpan } from '../../data/schema'
import type { Landmark, PoseFrame, PoseSeries } from '../../pose/types'

/** What a thumbnail keeps in memory: one frame's 33 image landmarks and the source size. */
export interface ThumbPose {
  points: Landmark[]
  width: number
  height: number
}

/** Phases whose middle best shows the movement, in order of preference. */
const SHOWCASE_PHASES = ['hold', 'turn', 'rise'] as const

const meanVisibility = (lm: Landmark[]) => lm.reduce((s, p) => s + p.visibility, 0) / (lm.length || 1)

/**
 * Index of the frame to draw: the tracked frame nearest the middle of the hold phase
 * (else turn, else rise) when phases are known, otherwise the tracked frame with the
 * highest mean visibility. -1 when no frame has landmarks.
 */
export function pickThumbFrame(frames: readonly PoseFrame[], phases?: readonly PhaseSpan[] | null): number {
  for (const name of SHOWCASE_PHASES) {
    const span = phases?.find((p) => p.phase === name && p.end > p.start)
    if (!span) continue
    const mid = (span.start + span.end) / 2
    let best = -1
    for (let i = 0; i < frames.length; i++) {
      const f = frames[i]
      if (!f.image || f.t < span.start || f.t > span.end) continue
      if (best < 0 || Math.abs(f.t - mid) < Math.abs(frames[best].t - mid)) best = i
    }
    if (best >= 0) return best
  }
  let best = -1
  let bestVis = -1
  for (let i = 0; i < frames.length; i++) {
    const lm = frames[i].image
    if (!lm) continue
    const v = meanVisibility(lm)
    if (v > bestVis) {
      best = i
      bestVis = v
    }
  }
  return best
}

/** The thumbnail pose of a series, or null when no frame was tracked. */
export function thumbPose(series: PoseSeries, phases?: readonly PhaseSpan[] | null): ThumbPose | null {
  const i = pickThumbFrame(series.frames, phases)
  if (i < 0) return null
  const image = series.frames[i].image as Landmark[]
  // A copy, so the decoded series can be garbage-collected.
  return { points: image.map((p) => ({ ...p })), width: series.width || 1280, height: series.height || 720 }
}
