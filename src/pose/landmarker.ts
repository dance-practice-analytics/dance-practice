// On-device pose estimation (FR-3.3.1, FR-3.3.2; SDD 5.3): a local video goes through
// MediaPipe Pose Landmarker in the browser/WebView and comes out as a PoseSeries.
//
// Privacy: the clip is only ever read through a local <video> element. Nothing in this
// module sends video, frames or keypoints anywhere; the only network requests are the
// downloads of the WASM runtime and the model file.
//
// This runs on the main thread, not in a worker, because decoding needs an
// HTMLVideoElement (not available in workers). Inference is synchronous per frame, and
// the loop yields to the event loop between frames so the UI stays responsive.

import { PoseLandmarker } from '@mediapipe/tasks-vision'
// Self-hosted runtime: Vite copies these two files from the npm package into the build
// (hashed assets), so they always match the installed package version and the service
// worker can cache them for offline use. Nothing is loaded from a CDN.
import wasmLoaderUrl from '@mediapipe/tasks-vision/vision_wasm_internal.js?url'
import wasmBinaryUrl from '@mediapipe/tasks-vision/vision_wasm_internal.wasm?url'
import { planFrames, toPoseFrame } from './frames'
import type { PoseFrame, PoseSeries } from './types'

export const WASM_FILESET = { wasmLoaderPath: wasmLoaderUrl, wasmBinaryPath: wasmBinaryUrl }

/** Stored in PoseSeries.model. The task asks for the "full" variant. */
export const MODEL_NAME = 'pose_landmarker_full'

/** Google's official MediaPipe model storage. */
export const MODEL_URL_OFFICIAL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task'

/** Self-hosted copy in public/mediapipe/ (same file, downloaded from the URL above). */
export const MODEL_URL_LOCAL = `${import.meta.env.BASE_URL}mediapipe/pose_landmarker_full.task`

/** Tried in order: the self-hosted copy first, the official URL if it is missing. */
export const MODEL_URLS = [MODEL_URL_LOCAL, MODEL_URL_OFFICIAL]

/** At most this long between two yields to the event loop while processing. */
const YIELD_EVERY_MS = 40
const SEEK_TIMEOUT_MS = 10_000
/** Timestamp gap left between two clips processed by the same landmarker. */
const CLIP_GAP_MS = 1_000

export type PoseDelegate = 'GPU' | 'CPU'

export interface EstimatePoseOptions {
  /** Called with 0..1 as frames are processed. */
  onProgress?(fraction: number): void
  signal?: AbortSignal
  /** Sampling rate; defaults to and is capped at 30 fps (SDD 5.3). */
  targetFps?: number
}

let landmarkerPromise: Promise<PoseLandmarker> | null = null
let activeDelegate: PoseDelegate | null = null
/** detectForVideo needs timestamps that increase for the lifetime of the landmarker. */
let nextTimestampMs = 0
/** One clip at a time: VIDEO mode tracks a single person between consecutive frames. */
let queue: Promise<unknown> = Promise.resolve()

async function fetchModel(): Promise<Uint8Array> {
  const problems: string[] = []
  for (const url of MODEL_URLS) {
    try {
      const response = await fetch(url)
      // A dev server answers a missing public file with index.html and status 200.
      const isHtml = (response.headers.get('content-type') ?? '').includes('text/html')
      if (response.ok && !isHtml) return new Uint8Array(await response.arrayBuffer())
      problems.push(`${url}: ${isHtml ? 'not a model file' : `HTTP ${response.status}`}`)
    } catch (error) {
      problems.push(`${url}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  throw new Error(`Could not load the pose model. ${problems.join('; ')}`)
}

async function createLandmarker(): Promise<PoseLandmarker> {
  const modelAssetBuffer = await fetchModel()
  const create = (delegate: PoseDelegate) =>
    PoseLandmarker.createFromOptions(WASM_FILESET, {
      baseOptions: { modelAssetBuffer, delegate },
      // GPU processing needs a canvas to bind its WebGL context to.
      canvas: document.createElement('canvas'),
      runningMode: 'VIDEO',
      numPoses: 1,
      outputSegmentationMasks: false,
    })
  try {
    const landmarker = await create('GPU')
    activeDelegate = 'GPU'
    return landmarker
  } catch {
    // No WebGL, a blocklisted driver, etc. (SDD 7: fall back from GPU to CPU).
    const landmarker = await create('CPU')
    activeDelegate = 'CPU'
    return landmarker
  }
}

/** Loads the runtime and model on first use; later calls reuse the same instance. */
export function getLandmarker(): Promise<PoseLandmarker> {
  if (!landmarkerPromise) {
    landmarkerPromise = createLandmarker().catch((error) => {
      landmarkerPromise = null // let the next call retry
      throw error
    })
  }
  return landmarkerPromise
}

/** Which delegate the current landmarker runs on, or null before it is created. */
export function currentDelegate(): PoseDelegate | null {
  return activeDelegate
}

/** Frees the model and WASM memory. The next estimatePose call loads them again. */
export async function disposeLandmarker(): Promise<void> {
  const pending = landmarkerPromise
  landmarkerPromise = null
  activeDelegate = null
  nextTimestampMs = 0
  if (pending) (await pending.catch(() => null))?.close()
}

const once = (video: HTMLVideoElement, event: 'loadeddata' | 'seeked', timeoutMs: number, what: string) =>
  new Promise<void>((resolve, reject) => {
    const done = (error?: Error) => {
      clearTimeout(timer)
      video.removeEventListener(event, onEvent)
      video.removeEventListener('error', onError)
      if (error) reject(error)
      else resolve()
    }
    const onEvent = () => done()
    const onError = () => done(new Error(`The video could not be ${what} (${video.error?.message || 'unknown error'}).`))
    const timer = setTimeout(() => done(new Error(`Timed out while the video was being ${what}.`)), timeoutMs)
    video.addEventListener(event, onEvent)
    video.addEventListener('error', onError)
  })

async function openVideo(src: string): Promise<HTMLVideoElement> {
  // Never attached to the document, so it stays hidden.
  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  video.preload = 'auto'
  const loaded = once(video, 'loadeddata', 30_000, 'loaded')
  video.src = src
  await loaded
  return video
}

async function seekTo(video: HTMLVideoElement, timeS: number): Promise<void> {
  const seeked = once(video, 'seeked', SEEK_TIMEOUT_MS, 'seeked')
  video.currentTime = timeS
  await seeked
}

const nextTask = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

async function run(source: File | string, opts: EstimatePoseOptions): Promise<PoseSeries> {
  const { onProgress, signal, targetFps } = opts
  signal?.throwIfAborted()
  const landmarker = await getLandmarker()
  signal?.throwIfAborted()

  // A File gets a blob URL that is revoked below; a string URL belongs to the caller.
  const objectUrl = typeof source === 'string' ? null : URL.createObjectURL(source)
  let video: HTMLVideoElement | null = null
  try {
    video = await openVideo(objectUrl ?? (source as string))
    const plan = planFrames(video.duration, targetFps, nextTimestampMs)
    const frames: PoseFrame[] = []
    let lastYield = performance.now()

    for (const planned of plan.frames) {
      signal?.throwIfAborted()
      // Seeking (rather than playing with requestVideoFrameCallback) gives every planned
      // frame exactly once regardless of how slow inference is, does not depend on the
      // tab being visible, and makes a re-run sample the same instants.
      await seekTo(video, planned.seekS)
      nextTimestampMs = planned.timestampMs + CLIP_GAP_MS
      frames.push(toPoseFrame(planned.t, landmarker.detectForVideo(video, planned.timestampMs)))
      onProgress?.(frames.length / plan.frames.length)
      if (performance.now() - lastYield > YIELD_EVERY_MS) {
        await nextTask()
        lastYield = performance.now()
      }
    }

    return {
      fps: plan.fps,
      durationS: video.duration,
      width: video.videoWidth,
      height: video.videoHeight,
      model: MODEL_NAME,
      smoothed: false,
      frames,
    }
  } finally {
    if (video) {
      video.removeAttribute('src')
      video.load() // releases the decoder and the file handle
    }
    if (objectUrl) URL.revokeObjectURL(objectUrl)
  }
}

/**
 * Runs pose estimation over a local clip and returns the raw (unsmoothed) series; frames
 * without a detected pose have `image: null, world: null`. Calls are queued, one clip at
 * a time. Rejects with the signal's reason (an AbortError by default) when aborted.
 */
export function estimatePose(video: File | string, opts: EstimatePoseOptions = {}): Promise<PoseSeries> {
  const result = queue.then(() => run(video, opts))
  queue = result.catch(() => undefined)
  return result
}
