// Left/right label swaps (FR-3.3.4, SDD 5.5 turn count). MediaPipe sometimes labels a
// body the wrong way round for a few frames, mostly when the dancer is edge-on to the
// camera in a turn. A swap is a labelling error, not a movement, so it is undone here,
// on the raw landmarks and before smoothing.
//
// Why before smoothing: smoothing a swapped frame drags each shoulder towards the other
// over several frames, so the shoulder line shrinks, flips and comes back as a fake
// rotation that no later step can tell from a real one. On synthetic pirouettes with
// tracker-like swaps (src/metrics/CALIBRATION.md) the turn count was exact in 20 of 20
// runs when the swaps reached the metrics engine unsmoothed, and wrong in 14–16 of 20
// runs (2 and 3 turns) once the same frames had been smoothed first.

import { LANDMARK_COUNT, LM, type Landmark, type PoseFrame, type PoseSeries } from './types'

/** Every left/right landmark pair of the MediaPipe Pose model (left index first). */
export const LEFT_RIGHT_PAIRS: readonly (readonly [number, number])[] = [
  [1, 4], // eye inner
  [2, 5], // eye
  [3, 6], // eye outer
  [LM.leftEar, LM.rightEar],
  [9, 10], // mouth
  [LM.leftShoulder, LM.rightShoulder],
  [LM.leftElbow, LM.rightElbow],
  [LM.leftWrist, LM.rightWrist],
  [17, 18], // pinky
  [19, 20], // index
  [21, 22], // thumb
  [LM.leftHip, LM.rightHip],
  [LM.leftKnee, LM.rightKnee],
  [LM.leftAnkle, LM.rightAnkle],
  [LM.leftHeel, LM.rightHeel],
  [LM.leftFootIndex, LM.rightFootIndex],
]

/** The rigid part of the body the decision is made on: shoulders and hips. */
const TORSO_PAIRS = [
  [LM.leftShoulder, LM.rightShoulder],
  [LM.leftHip, LM.rightHip],
] as const

/** Torso landmarks below this visibility give no decision (the metrics engine's TRACK_MIN). */
export const SWAP_MIN_VISIBILITY = 0.3

const dist = (a: Landmark, b: Landmark) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)

function torsoSeen(w: Landmark[] | null): w is Landmark[] {
  if (!w || w.length !== LANDMARK_COUNT) return false
  return TORSO_PAIRS.every(([l, r]) => w[l].visibility >= SWAP_MIN_VISIBILITY && w[r].visibility >= SWAP_MIN_VISIBILITY)
}

/**
 * True when frame `w` matches the previous frame `prev` better with its left and right
 * labels exchanged. For a rigid torso this is the same as an apparent rotation of more
 * than 90° about the vertical between two frames: 2700°/s at 30 fps, over seven turns a
 * second, which no dancer does, while a swap during a real turn of up to 90° per frame
 * still shows as a jump of more than 90°.
 */
export function looksSwapped(w: Landmark[], prev: Landmark[]): boolean {
  let keep = 0
  let swap = 0
  for (const [l, r] of TORSO_PAIRS) {
    keep += dist(w[l], prev[l]) + dist(w[r], prev[r])
    swap += dist(w[l], prev[r]) + dist(w[r], prev[l])
  }
  return swap < keep
}

function exchange(landmarks: Landmark[] | null): Landmark[] | null {
  if (!landmarks || landmarks.length !== LANDMARK_COUNT) return landmarks
  const out = landmarks.slice()
  for (const [l, r] of LEFT_RIGHT_PAIRS) {
    out[l] = landmarks[r]
    out[r] = landmarks[l]
  }
  return out
}

/**
 * Returns a copy of the series in which frames whose labels are swapped relative to the
 * previous frame are relabeled (image and world, every left/right pair) and marked
 * `relabeled: true`. Each frame is compared with the previous frame AFTER its own
 * correction, so a swap that lasts several frames is undone in all of them.
 *
 * Only neighbouring frames are compared: across a gap, or a frame whose torso is not
 * tracked, the rotation in between is unknown and nothing is changed. Positions are
 * never altered, only which side they are filed under.
 */
export function unswapLeftRight(series: PoseSeries): PoseSeries {
  let prev: Landmark[] | null = null
  const frames: PoseFrame[] = series.frames.map((frame) => {
    const w = frame.world
    if (!torsoSeen(w)) {
      prev = null
      return frame
    }
    if (prev && looksSwapped(w, prev)) {
      const world = exchange(w) as Landmark[]
      prev = world
      return { ...frame, image: exchange(frame.image), world, relabeled: true }
    }
    prev = w
    return frame
  })
  return { ...series, frames }
}
