// Pure helpers of the pose pipeline (no DOM, no MediaPipe import), so they can be unit-tested.

import { LANDMARK_COUNT, type Landmark, type PoseFrame } from './types'

/** SDD 5.3: frames are read at the clip's frame interval, capped at 30 fps. */
export const MAX_FPS = 30
/**
 * Browsers do not expose a clip's native frame rate, so the default is the cap.
 * A clip recorded below 30 fps simply yields some repeated frames.
 */
export const DEFAULT_TARGET_FPS = MAX_FPS

/**
 * Seek target = sample time + this offset, in seconds.
 *
 * Measured in headless Chrome with requestVideoFrameCallback on a synthetic 30 fps test
 * clip (scripts/calibrate-metrics.mjs --seek-check), 300 seeks per offset:
 * - offset 0 (the frame start): the previous frame in 93 of 300 seeks, because the
 *   container timestamps round to just after i/30;
 * - offset half a frame (planFrames up to mt2-metrics-1.1.0): the NEXT frame in 10 of
 *   300 seeks (every 30th frame, the same ones on every run); 0.9 frame: 30 of 300;
 * - every offset from 0.1 ms to 0.49 frame: 0 of 300.
 * A fixed 2 ms clears millisecond timestamp rounding (WebM, some MP4 muxers) and stays
 * far from the late part of the frame for any clip up to 240 fps. It is absolute, not a
 * share of the sampling interval, because the clip's own frame rate is unknown and can
 * be higher than the sampling rate.
 */
export const SEEK_OFFSET_S = 0.002

export interface PlannedFrame {
  /** Time stored in the PoseFrame: the start of the sampling interval, in seconds. */
  t: number
  /** Where the video is seeked to: SEEK_OFFSET_S after `t`, so the seek lands inside the
   *  frame that starts at `t`, neither on the previous one nor on the next. */
  seekS: number
  /** Timestamp handed to detectForVideo, in whole milliseconds, strictly increasing. */
  timestampMs: number
}

export interface FramePlan {
  fps: number
  frames: PlannedFrame[]
}

export function clampFps(targetFps: number | undefined): number {
  if (targetFps === undefined) return DEFAULT_TARGET_FPS
  if (!Number.isFinite(targetFps) || targetFps <= 0) {
    throw new RangeError(`targetFps must be a positive number, got ${targetFps}`)
  }
  return Math.min(targetFps, MAX_FPS)
}

/** FR-3.2.7: the part of a clip to process, in seconds of the original clip. */
export interface TrimRange {
  startS: number
  endS: number
}

/**
 * Shortest trimmed part accepted. The metrics take the floor level from 0.5–1.0 s into
 * what is processed (src/metrics/phases.ts), so anything shorter can't be measured.
 */
export const MIN_TRIM_S = 1.5
const END_SLACK_S = 0.25

/**
 * Checks a trim against the clip length. Returns a sentence for the form, or null when
 * it is usable. Both ends are optional in the form; pass 0 / the duration for an open end.
 */
export function trimProblem(range: TrimRange, durationS: number): string | null {
  const { startS, endS } = range
  if (!Number.isFinite(startS) || !Number.isFinite(endS)) return 'Enter the times in seconds.'
  if (startS < 0) return 'The start can’t be before the beginning of the clip.'
  if (Number.isFinite(durationS) && durationS > 0 && endS > durationS + 1e-3) {
    return `The end can’t be after the end of the clip (${durationS.toFixed(1)} s).`
  }
  if (endS <= startS) return 'The end has to come after the start.'
  if (endS - startS < MIN_TRIM_S) return `Keep at least ${MIN_TRIM_S} s between start and end.`
  return null
}

/**
 * The trim to apply, or null when there is none to apply: no range, or a range that
 * covers the whole clip (within one frame). Throws RangeError on an unusable range.
 */
export function normalizeTrim(range: TrimRange | null | undefined, durationS: number): TrimRange | null {
  if (!range) return null
  // The decoder can report a few frames less than the probe that the form validated
  // against; an end within that slack means "to the end".
  const endS = range.endS > durationS && range.endS - durationS < END_SLACK_S ? durationS : range.endS
  const startS = range.startS
  const problem = trimProblem({ startS, endS }, durationS)
  if (problem) throw new RangeError(`Unusable trim: ${problem}`)
  if (startS < 1 / (MAX_FPS * 2) && endS > durationS - 1 / (MAX_FPS * 2)) return null
  return { startS, endS }
}

/**
 * Plans which instants of a clip are sampled. `baseTimestampMs` offsets the MediaPipe
 * timestamps so they keep increasing when one landmarker processes several clips.
 *
 * With a `range` (FR-3.2.7 trim) only the samples whose time falls in [startS, endS) are
 * planned. They stay on the same grid (i / fps) and keep times of the ORIGINAL clip, so a
 * trimmed series lines up with the untouched local video in Review without any offset.
 */
export function planFrames(durationS: number, targetFps?: number, baseTimestampMs = 0, range?: TrimRange | null): FramePlan {
  if (!Number.isFinite(durationS) || durationS <= 0) {
    throw new RangeError(`The clip has no usable duration (${durationS}).`)
  }
  const fps = clampFps(targetFps)
  const trim = normalizeTrim(range, durationS)
  // The epsilon keeps 10 s at 30 fps at exactly 300 frames despite float error.
  const total = Math.max(1, Math.floor(durationS * fps + 1e-6))
  const first = trim ? Math.ceil(trim.startS * fps - 1e-6) : 0
  const count = trim ? Math.min(total, Math.ceil(trim.endS * fps - 1e-6)) : total
  const lastSeekable = Math.max(0, durationS - 1e-3)
  const frames: PlannedFrame[] = []
  for (let i = first; i < count; i++) {
    const t = i / fps
    frames.push({
      t,
      seekS: Math.min(t + SEEK_OFFSET_S, lastSeekable),
      timestampMs: baseTimestampMs + Math.round(t * 1000),
    })
  }
  return { fps, frames }
}

interface RawLandmark {
  x: number
  y: number
  z: number
  visibility?: number
}

/** The part of MediaPipe's PoseLandmarkerResult this module reads. */
export interface RawPoseResult {
  landmarks: RawLandmark[][]
  worldLandmarks: RawLandmark[][]
}

const copyLandmarks = (raw: RawLandmark[] | undefined): Landmark[] | null => {
  if (!raw || raw.length !== LANDMARK_COUNT) return null
  // Only the contract fields are kept (`presence` is dropped).
  return raw.map((lm) => ({ x: lm.x, y: lm.y, z: lm.z, visibility: lm.visibility ?? 0 }))
}

/**
 * Converts the first detected pose into a PoseFrame. When no pose (or an incomplete one)
 * comes back, both landmark sets are null: a gap, never a filled-in value.
 */
export function toPoseFrame(t: number, result: RawPoseResult): PoseFrame {
  const image = copyLandmarks(result.landmarks[0])
  const world = copyLandmarks(result.worldLandmarks[0])
  if (!image || !world) return { t, image: null, world: null }
  return { t, image, world }
}
