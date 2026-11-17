// On-device processing queue (FR-3.3.x, FR-3.4.x). One clip at a time:
//   status 'processing' → estimatePose → smoothSeries → encodeSeries → uploadKeypoints
//   → computeMetrics → saveMetrics → status 'done'   (or 'failed' with a reason).
// The clip itself is only read locally; what leaves the device is the gzipped
// keypoints and the metrics row.

import { useSyncExternalStore } from 'react'
import { ApiError } from '../api/errors'
import { saveMetrics, setAttemptStatus, uploadKeypoints } from '../data/repo'
import type { MovementType } from '../data/schema'
import { computeMetrics } from '../metrics/engine'
import { encodeSeries } from '../pose/codec'
import { currentDelegate, estimatePose, type PoseDelegate } from '../pose/landmarker'
import { smoothSeries } from '../pose/oneEuro'
import type { PoseSeries } from '../pose/types'
import { client } from './auth'
import { getClip } from './clips'
import { processingWakeLock } from './wakeLock'

export type PipelineStatus = 'queued' | 'processing' | 'done' | 'failed' | 'cancelled'

/** Steps inside 'processing', for the detail line of the Processing screen. */
export type PipelineStep = 'loading_model' | 'pose' | 'saving_keypoints' | 'metrics'

export interface PipelineJob {
  attemptId: string
  movement: MovementType
  /** For display only. */
  clipName?: string | null
}

export interface PipelineItem extends PipelineJob {
  status: PipelineStatus
  step: PipelineStep | null
  /** 0..1 of the pose step (the long one); 1 once the pose is done. */
  fraction: number
  /** Dancer-safe sentence, present when status is 'failed'. */
  reason: string | null
  /** What to do about it, when known. */
  recovery: string | null
  /** Filled when done: frames read and frames with a detected pose. */
  frames: number | null
  trackedFrames: number | null
  startedAt: number | null
  finishedAt: number | null
}

export interface PipelineState {
  /** In the order they were enqueued. */
  items: PipelineItem[]
  /** True while holding: the clip in progress finishes, the next one doesn't start. */
  paused: boolean
  /** The attempt being processed now, if any. */
  activeId: string | null
  /** 'GPU' or 'CPU' once the pose model has loaded. */
  delegate: PoseDelegate | null
}

let state: PipelineState = { items: [], paused: false, activeId: null, delegate: null }
const listeners = new Set<() => void>()
const finishedListeners = new Set<(attemptId: string, status: PipelineStatus) => void>()

function set(next: Partial<PipelineState>) {
  state = { ...state, ...next }
  listeners.forEach((l) => l())
}

function patch(attemptId: string, change: Partial<PipelineItem>) {
  set({ items: state.items.map((it) => (it.attemptId === attemptId ? { ...it, ...change } : it)) })
}

const subscribe = (cb: () => void) => {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

export function getPipeline(): PipelineState {
  return state
}

/** The whole queue; re-renders on every progress step, so read it in small components. */
export function usePipeline(): PipelineState {
  return useSyncExternalStore(subscribe, getPipeline)
}

/** One attempt's item, or null when it was never enqueued in this tab. */
export function usePipelineItem(attemptId: string | null | undefined): PipelineItem | null {
  return useSyncExternalStore(subscribe, () => state.items.find((it) => it.attemptId === attemptId) ?? null)
}

/** Called after each attempt reaches done / failed / cancelled. Returns the unsubscribe. */
export function onAttemptFinished(cb: (attemptId: string, status: PipelineStatus) => void): () => void {
  finishedListeners.add(cb)
  return () => {
    finishedListeners.delete(cb)
  }
}

// ---------- pose cache ----------

const CACHE_MAX = 8
const seriesCache = new Map<string, PoseSeries>()

/** Keeps the (smoothed) series of an attempt so Review opens without a download. */
export function cacheSeries(attemptId: string, series: PoseSeries): void {
  seriesCache.delete(attemptId)
  seriesCache.set(attemptId, series)
  // Oldest out: a series is a few MB in memory.
  while (seriesCache.size > CACHE_MAX) seriesCache.delete(seriesCache.keys().next().value as string)
}

export function getCachedSeries(attemptId: string): PoseSeries | null {
  return seriesCache.get(attemptId) ?? null
}

// ---------- queue ----------

const fresh = (job: PipelineJob): PipelineItem => ({
  ...job,
  status: 'queued',
  step: null,
  fraction: 0,
  reason: null,
  recovery: null,
  frames: null,
  trackedFrames: null,
  startedAt: null,
  finishedAt: null,
})

/**
 * Adds attempts to the queue and starts it. The clip of each attempt must be in the
 * clips registry (`registerClip`) — the file is read from there. An attempt that is
 * already queued or processing is left alone; a finished one is queued again (re-run).
 */
export function enqueue(jobs: readonly PipelineJob[]): void {
  const items = [...state.items]
  for (const job of jobs) {
    const at = items.findIndex((it) => it.attemptId === job.attemptId)
    if (at < 0) items.push(fresh(job))
    else if (items[at].status !== 'queued' && items[at].status !== 'processing') {
      // Re-runs go to the back of the queue.
      items.splice(at, 1)
      items.push(fresh(job))
    }
  }
  set({ items })
  void pump()
}

/** Holds the queue after the clip in progress. */
export function pause(): void {
  if (!state.paused) set({ paused: true })
}

export function resume(): void {
  if (!state.paused) return
  set({ paused: false })
  void pump()
}

let abort: AbortController | null = null

/**
 * Cancels one attempt, or everything still queued or running when no id is given.
 * A cancelled attempt goes back to 'queued' in the database (there is no cancelled
 * status there) and shows as cancelled in this tab.
 */
export function cancel(attemptId?: string): void {
  const hit = (it: PipelineItem) => (attemptId ? it.attemptId === attemptId : true)
  const now = Date.now()
  set({
    items: state.items.map((it) =>
      hit(it) && it.status === 'queued' ? { ...it, status: 'cancelled', finishedAt: now } : it,
    ),
  })
  if (state.activeId && (!attemptId || attemptId === state.activeId)) abort?.abort()
}

/** Drops finished, failed and cancelled items from the list (the rows stay in Supabase). */
export function clearFinished(): void {
  set({ items: state.items.filter((it) => it.status === 'queued' || it.status === 'processing') })
}

/** Empties the queue; called on sign-out. */
export function resetPipeline(): void {
  cancel()
  seriesCache.clear()
  set({ items: [], paused: false })
}

let pumping = false

async function pump(): Promise<void> {
  if (pumping) return
  pumping = true
  try {
    for (;;) {
      if (state.paused) return
      const next = state.items.find((it) => it.status === 'queued')
      if (!next) return
      // FR-3.8.5: keep the screen on while clips are processing; a no-op where unsupported.
      processingWakeLock.setActive(true)
      await processOne(next)
    }
  } finally {
    pumping = false
    // Queue empty, paused or reset: the screen may sleep again.
    processingWakeLock.setActive(false)
    set({ activeId: null })
  }
}

const isAbort = (e: unknown) => e instanceof DOMException && e.name === 'AbortError'

/** Any failure → a sentence about the clip or the device, never about the dancer. */
export function failureCopy(e: unknown): { reason: string; recovery: string | null } {
  if (e instanceof ApiError) return { reason: e.message, recovery: e.recovery ?? null }
  const text = e instanceof Error ? e.message : String(e)
  if (/pose model|wasm|createFromOptions|landmarker/i.test(text)) {
    return {
      reason: 'The pose model didn’t load. It runs inside this browser; your clips are untouched.',
      recovery: 'Check the connection once (the model is downloaded the first time), then try again.',
    }
  }
  if (/could not be (loaded|seeked)|timed out|no usable duration/i.test(text)) {
    return {
      reason: 'This browser can’t read this clip.',
      recovery: 'Export it as MP4 (H.264) and import again.',
    }
  }
  return { reason: 'Processing stopped unexpectedly. Your clip is untouched.', recovery: 'Try again.' }
}

/** FR-3.3.8: the attempt fails when no person is detected in more than half of the frames. */
export function mostlyUntracked(frames: number, tracked: number): boolean {
  return frames === 0 || tracked < frames / 2
}

const NO_PERSON = {
  reason: 'No person was found in most of this clip, so nothing was measured.',
  recovery: 'Check that the whole body is in the frame and well lit, then import the clip again.',
}

async function processOne(job: PipelineItem): Promise<void> {
  const id = job.attemptId
  const controller = new AbortController()
  abort = controller
  const signal = controller.signal
  set({ activeId: id })
  patch(id, { status: 'processing', step: 'loading_model', fraction: 0, startedAt: Date.now() })

  const finish = (status: PipelineStatus, change: Partial<PipelineItem> = {}) => {
    patch(id, { status, step: null, finishedAt: Date.now(), ...change })
    finishedListeners.forEach((l) => l(id, status))
  }

  try {
    const clip = getClip(id)
    if (!clip) {
      // Nothing was attempted, so the database row is left as it is.
      finish('failed', {
        reason: 'The video for this clip isn’t open in this tab.',
        recovery: 'Choose the file again; it stays on this device.',
      })
      return
    }
    const db = client()
    await setAttemptStatus(db, id, 'processing')

    let lastShown = -1
    const raw = await estimatePose(clip.file, {
      signal,
      onProgress: (fraction) => {
        // Whole percents only: the store shouldn't notify 30 times a second.
        const shown = Math.floor(fraction * 100)
        if (shown === lastShown) return
        lastShown = shown
        set({ delegate: currentDelegate() })
        patch(id, { step: 'pose', fraction })
      },
    })
    signal.throwIfAborted()
    const series = smoothSeries(raw)
    const tracked = series.frames.reduce((n, f) => n + (f.image ? 1 : 0), 0)
    patch(id, { step: 'saving_keypoints', fraction: 1, frames: series.frames.length, trackedFrames: tracked })
    set({ delegate: currentDelegate() })

    if (mostlyUntracked(series.frames.length, tracked)) {
      // FR-3.3.8: nothing is stored for a clip without a person in most of its frames.
      const { reason, recovery } = NO_PERSON
      await setAttemptStatus(db, id, 'failed', reason)
      finish('failed', { reason, recovery })
      return
    }

    const blob = await encodeSeries(series)
    await uploadKeypoints(db, id, blob, series.frames.length, series.model)
    cacheSeries(id, series)
    signal.throwIfAborted()

    patch(id, { step: 'metrics' })
    const { movement, algorithm_version, phases, confidence, ...values } = computeMetrics(series, job.movement)
    await saveMetrics(db, id, { movement, algorithm_version, phases, confidence, ...values })
    await setAttemptStatus(db, id, 'done')
    finish('done')
  } catch (e) {
    if (isAbort(e) || signal.aborted) {
      await setAttemptStatus(client(), id, 'queued').catch(() => undefined)
      finish('cancelled')
      return
    }
    const { reason, recovery } = failureCopy(e)
    // The reason is saved with the row so the library shows it after a reload too.
    await setAttemptStatus(client(), id, 'failed', reason).catch(() => undefined)
    finish('failed', { reason, recovery })
  } finally {
    if (abort === controller) abort = null
  }
}
