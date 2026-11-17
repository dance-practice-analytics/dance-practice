// Pose data contract shared by the pose pipeline (FR-3.3.x), the metrics engine
// (FR-3.4.x) and the review screens. One PoseSeries per attempt; it is what gets
// gzipped into the private `keypoints` bucket ({uid}/{attempt_id}.json.gz).

/** One MediaPipe landmark. `visibility` is 0..1. */
export interface Landmark {
  x: number
  y: number
  z: number
  visibility: number
}

/**
 * One video frame. `image` is normalized to the frame (x, y in 0..1, origin top-left);
 * `world` is in metres with the origin at the hip midpoint (y points down, as MediaPipe gives it).
 * Both are null when no pose was detected: a gap, never a filled-in value.
 */
export interface PoseFrame {
  /** Seconds from the start of the clip. */
  t: number
  image: Landmark[] | null
  world: Landmark[] | null
  /** True when the tracker's left/right labels were swapped in this frame and have been
   *  exchanged back (src/pose/swaps.ts). Absent otherwise. */
  relabeled?: true
}

export interface PoseSeries {
  /** Sampling rate of `frames`, in frames per second. */
  fps: number
  durationS: number
  /** Source video size in pixels. */
  width: number
  height: number
  /** e.g. 'pose_landmarker_full'. */
  model: string
  /** True once One-Euro smoothing has been applied. */
  smoothed: boolean
  /**
   * FR-3.2.7: set when only part of the clip was processed. Frame times stay those of
   * the original clip (the first frame is at or after startS) and `durationS` stays the
   * whole clip, so the series lines up with the untrimmed local video. Absent = whole clip.
   */
  trim?: { startS: number; endS: number }
  frames: PoseFrame[]
}

export const LANDMARK_COUNT = 33

/** MediaPipe Pose landmark indices. */
export const LM = {
  nose: 0,
  leftEar: 7,
  rightEar: 8,
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
  leftHip: 23,
  rightHip: 24,
  leftKnee: 25,
  rightKnee: 26,
  leftAnkle: 27,
  rightAnkle: 28,
  leftHeel: 29,
  rightHeel: 30,
  leftFootIndex: 31,
  rightFootIndex: 32,
} as const
