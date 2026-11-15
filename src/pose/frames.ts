// Pure helpers of the pose pipeline (no DOM, no MediaPipe import), so they can be unit-tested.

import { LANDMARK_COUNT, type Landmark, type PoseFrame } from './types'

/** SDD 5.3: frames are read at the clip's frame interval, capped at 30 fps. */
export const MAX_FPS = 30
/**
 * Browsers do not expose a clip's native frame rate, so the default is the cap.
 * A clip recorded below 30 fps simply yields some repeated frames.
 */
export const DEFAULT_TARGET_FPS = MAX_FPS

export interface PlannedFrame {
  /** Time stored in the PoseFrame: the start of the sampling interval, in seconds. */
  t: number
  /** Where the video is seeked to: the middle of the interval, so a seek that rounds
   *  down never lands on the previous frame. */
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

/**
 * Plans which instants of a clip are sampled. `baseTimestampMs` offsets the MediaPipe
 * timestamps so they keep increasing when one landmarker processes several clips.
 */
export function planFrames(durationS: number, targetFps?: number, baseTimestampMs = 0): FramePlan {
  if (!Number.isFinite(durationS) || durationS <= 0) {
    throw new RangeError(`The clip has no usable duration (${durationS}).`)
  }
  const fps = clampFps(targetFps)
  // The epsilon keeps 10 s at 30 fps at exactly 300 frames despite float error.
  const count = Math.max(1, Math.floor(durationS * fps + 1e-6))
  const lastSeekable = Math.max(0, durationS - 1e-3)
  const frames: PlannedFrame[] = []
  for (let i = 0; i < count; i++) {
    const t = i / fps
    frames.push({
      t,
      seekS: Math.min(t + 0.5 / fps, lastSeekable),
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
