// Keypoint file codec (FR-3.3.6, NFR-10): PoseSeries <-> gzipped JSON for the private
// `keypoints` bucket ({uid}/{attempt_id}.json.gz). The file holds numbers only, no image data.
//
// To stay small, coordinates are quantized to integers and each frame is stored as the
// difference from the previous detected frame (integers, so decoding is exact and does
// not drift). Gap frames are stored as null and decoded as null.
//
// File layout (version 1):
//   { format, version, fps, durationS, width, height, model, smoothed,
//     t:     number[]                 seconds, rounded to 0.1 ms
//     image: (number[] | null)[]      per frame: 33 x [x, y, z, visibility] quantized deltas
//     world: (number[] | null)[]      same layout
//     relabeled?: number[] }          indices of frames whose left/right labels were
//                                     exchanged back (src/pose/swaps.ts); optional, so
//                                     files written before it read as "none"

import { LANDMARK_COUNT, type Landmark, type PoseFrame, type PoseSeries } from './types'

export const KEYPOINTS_FORMAT = 'dpa-pose-series'
export const KEYPOINTS_VERSION = 1
export const KEYPOINTS_MIME = 'application/gzip'

/**
 * Rounding steps (defaults chosen here; the SDD does not set them). All are far below
 * the model's own noise: 1e-4 of the frame is 0.2 px on a 1920 px wide clip.
 */
export const PRECISION = {
  /** Image x/y/z, as a fraction of the frame. */
  image: 1e-4,
  /** World x/y/z, in metres (0.1 mm). */
  world: 1e-4,
  visibility: 1e-2,
  /** Frame time, in seconds. */
  time: 1e-4,
} as const

const VALUES_PER_LANDMARK = 4
const VALUES_PER_FRAME = LANDMARK_COUNT * VALUES_PER_LANDMARK

interface KeypointsFile {
  format: string
  version: number
  fps: number
  durationS: number
  width: number
  height: number
  model: string
  smoothed: boolean
  t: number[]
  image: (number[] | null)[]
  world: (number[] | null)[]
  relabeled?: number[]
}

const quantize = (value: number, step: number) => {
  const q = Math.round(value / step)
  // Math.round can give -0, which JSON would write as 0 anyway; NaN/Infinity must not pass.
  if (!Number.isFinite(q)) throw new Error('Cannot encode a pose series with non-finite values.')
  return q === 0 ? 0 : q
}

function encodeTrack(frames: PoseFrame[], key: 'image' | 'world', step: number): (number[] | null)[] {
  let prev = new Array<number>(VALUES_PER_FRAME).fill(0)
  return frames.map((frame) => {
    const landmarks = frame[key]
    if (!landmarks) return null
    if (landmarks.length !== LANDMARK_COUNT) {
      throw new Error(`Cannot encode a frame with ${landmarks.length} landmarks (expected ${LANDMARK_COUNT}).`)
    }
    const abs = new Array<number>(VALUES_PER_FRAME)
    landmarks.forEach((lm, i) => {
      abs[i * 4] = quantize(lm.x, step)
      abs[i * 4 + 1] = quantize(lm.y, step)
      abs[i * 4 + 2] = quantize(lm.z, step)
      abs[i * 4 + 3] = quantize(lm.visibility, PRECISION.visibility)
    })
    const delta = abs.map((v, i) => v - prev[i])
    prev = abs
    return delta
  })
}

function decodeTrack(track: (number[] | null)[], step: number): (Landmark[] | null)[] {
  let prev = new Array<number>(VALUES_PER_FRAME).fill(0)
  return track.map((delta) => {
    if (delta === null) return null
    const abs = delta.map((v, i) => v + prev[i])
    prev = abs
    const landmarks: Landmark[] = []
    for (let i = 0; i < LANDMARK_COUNT; i++) {
      landmarks.push({
        x: abs[i * 4] * step,
        y: abs[i * 4 + 1] * step,
        z: abs[i * 4 + 2] * step,
        visibility: abs[i * 4 + 3] * PRECISION.visibility,
      })
    }
    return landmarks
  })
}

/** Serializes a series to gzipped JSON. Values are rounded to `PRECISION`. */
export async function encodeSeries(series: PoseSeries): Promise<Blob> {
  const file: KeypointsFile = {
    format: KEYPOINTS_FORMAT,
    version: KEYPOINTS_VERSION,
    fps: series.fps,
    durationS: series.durationS,
    width: series.width,
    height: series.height,
    model: series.model,
    smoothed: series.smoothed,
    t: series.frames.map((f) => quantize(f.t, PRECISION.time)),
    image: encodeTrack(series.frames, 'image', PRECISION.image),
    world: encodeTrack(series.frames, 'world', PRECISION.world),
  }
  const relabeled = series.frames.flatMap((f, i) => (f.relabeled ? [i] : []))
  if (relabeled.length) file.relabeled = relabeled
  const json = new Blob([JSON.stringify(file)])
  const gzipped = json.stream().pipeThrough(new CompressionStream('gzip'))
  return new Blob([await new Response(gzipped).arrayBuffer()], { type: KEYPOINTS_MIME })
}

const fail = (why: string): never => {
  throw new Error(`Invalid keypoints file: ${why}`)
}

const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

function checkTrack(value: unknown, name: string, frameCount: number): (number[] | null)[] {
  if (!Array.isArray(value)) return fail(`"${name}" is not an array.`)
  if (value.length !== frameCount) {
    return fail(`"${name}" has ${value.length} frames but "t" has ${frameCount}.`)
  }
  value.forEach((frame: unknown, i) => {
    if (frame === null) return
    if (!Array.isArray(frame) || frame.length !== VALUES_PER_FRAME) {
      fail(`"${name}" frame ${i} is not null or a list of ${VALUES_PER_FRAME} values.`)
    }
    if (!(frame as unknown[]).every((v) => Number.isInteger(v))) {
      fail(`"${name}" frame ${i} contains a value that is not an integer.`)
    }
  })
  return value as (number[] | null)[]
}

function checkFile(value: unknown): KeypointsFile {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return fail('not a JSON object.')
  const f = value as Record<string, unknown>
  if (f.format !== KEYPOINTS_FORMAT) return fail(`unknown format ${JSON.stringify(f.format)}.`)
  if (f.version !== KEYPOINTS_VERSION) return fail(`unsupported version ${JSON.stringify(f.version)}.`)
  if (!isNumber(f.fps) || f.fps <= 0) return fail('"fps" must be a positive number.')
  if (!isNumber(f.durationS) || f.durationS < 0) return fail('"durationS" must be a number.')
  if (!isNumber(f.width) || !isNumber(f.height)) return fail('"width" and "height" must be numbers.')
  if (typeof f.model !== 'string') return fail('"model" must be a string.')
  if (typeof f.smoothed !== 'boolean') return fail('"smoothed" must be a boolean.')
  if (!Array.isArray(f.t) || !f.t.every((v) => Number.isInteger(v))) {
    return fail('"t" must be a list of integers.')
  }
  checkTrack(f.image, 'image', f.t.length)
  checkTrack(f.world, 'world', f.t.length)
  if (f.relabeled !== undefined) {
    const n = f.t.length
    if (!Array.isArray(f.relabeled) || !f.relabeled.every((v) => Number.isInteger(v) && v >= 0 && v < n)) {
      return fail('"relabeled" must be a list of frame indices.')
    }
  }
  return f as unknown as KeypointsFile
}

/** Reads a file written by `encodeSeries`. Throws a descriptive Error on anything else. */
export async function decodeSeries(blob: Blob): Promise<PoseSeries> {
  let text: string
  try {
    text = await new Response(blob.stream().pipeThrough(new DecompressionStream('gzip'))).text()
  } catch {
    return fail('it is not gzip data.')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return fail('it does not contain JSON.')
  }
  const file = checkFile(parsed)
  const image = decodeTrack(file.image, PRECISION.image)
  const world = decodeTrack(file.world, PRECISION.world)
  const relabeled = new Set(file.relabeled ?? [])
  return {
    fps: file.fps,
    durationS: file.durationS,
    width: file.width,
    height: file.height,
    model: file.model,
    smoothed: file.smoothed,
    frames: file.t.map((t, i) => {
      const frame: PoseFrame = { t: t * PRECISION.time, image: image[i], world: world[i] }
      if (relabeled.has(i)) frame.relabeled = true
      return frame
    }),
  }
}
