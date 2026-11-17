// Offline upload queue (FR-3.8.6). When a clip has been processed on the device but
// saving to Supabase fails because the device is offline or the network errors, the
// result is kept in IndexedDB and saved later: on the `online` event, when the app
// starts after sign-in, and from the "Retry now" button.
//
// What is kept: the gzipped keypoints (bytes), the metrics row and the attempt id,
// tagged with the owner's user id. Never the video, a frame or an image: `enqueue`
// refuses anything that isn't gzip, and uploads go through the same repo functions as
// the live path, so the path stays `{uid}/{attempt}.json.gz` under RLS.
// Entries are cleared on success, on sign-out and on "delete all my data", so another
// account on the same device never uploads them; flushing only touches entries of the
// signed-in user.

import type { SupabaseClient } from '@supabase/supabase-js'
import { ApiError } from '../../api/errors'
import { dataError, saveMetrics, setAttemptStatus, uploadKeypoints, type MetricsInput } from '../../data/repo'
import { createStore, useStore } from '../../state/store'
import { idbClear, idbDelete, idbGetAll, idbPut } from './idb'

export interface PendingUpload {
  attemptId: string
  ownerId: string
  /** Gzipped PoseSeries, as produced by encodeSeries. */
  keypoints: ArrayBuffer
  frameCount: number
  model: string
  metrics: MetricsInput
  clipName: string | null
  queuedAt: number
  tries: number
}

/** What the pipeline hands over once a clip is processed. */
export interface ProcessedResult {
  attemptId: string
  keypoints: Blob
  frameCount: number
  model: string
  metrics: MetricsInput
  clipName?: string | null
}

export interface QueueContext {
  db: SupabaseClient
  uid: string
}

export interface OfflineQueueState {
  /** Attempt ids waiting to upload for the signed-in user. */
  ids: string[]
  flushing: boolean
  /** Last failure of a retry, dancer-safe. */
  lastError: ApiError | null
  /** IndexedDB missing or blocked (private mode): results can't be kept. */
  unavailable: boolean
}

export const offlineStore = createStore<OfflineQueueState>({ ids: [], flushing: false, lastError: null, unavailable: false })

export function useOfflineQueue(): OfflineQueueState {
  return useStore(offlineStore)
}

let getContext: () => QueueContext | null = () => null

/** The app tells the queue how to reach Supabase and who is signed in. */
export function bindQueue(fn: () => QueueContext | null): void {
  getContext = fn
}

const uploadedListeners = new Set<(attemptId: string) => void>()

/** Called after a queued result has been saved. Returns the unsubscribe. */
export function onUploaded(cb: (attemptId: string) => void): () => void {
  uploadedListeners.add(cb)
  return () => {
    uploadedListeners.delete(cb)
  }
}

const isOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false

// Problems with the data or the account: retrying the same bytes can't fix them.
const PERMANENT = new Set(['invalid', 'not_keypoints', 'invalid_status', 'permission', 'not_found', 'duplicate', 'too_large', 'storage_quota', 'not_configured'])

/** True for a failure that a later retry of the same result may get past. */
export function isRetryableSaveError(e: unknown): boolean {
  const err = dataError(e)
  if (PERMANENT.has(err.code)) return false
  if (err.code === 'network' || err.code === 'rate_limited') return true
  // Offline, a token refresh can fail and look like a sign-in problem.
  return isOffline()
}

/** The live save order: keypoints first, then metrics, then status done (all upserts, so a retry is safe). */
export async function saveResult(db: SupabaseClient, r: { attemptId: string; keypoints: Blob; frameCount: number; model: string; metrics: MetricsInput }): Promise<void> {
  await uploadKeypoints(db, r.attemptId, r.keypoints, r.frameCount, r.model)
  await saveMetrics(db, r.attemptId, r.metrics)
  await setAttemptStatus(db, r.attemptId, 'done')
}

async function isGzip(blob: Blob): Promise<boolean> {
  const head = new Uint8Array(await blob.slice(0, 2).arrayBuffer())
  return head.length === 2 && head[0] === 0x1f && head[1] === 0x8b && !/^(video|image)\//.test(blob.type)
}

const toBlob = (p: PendingUpload) => new Blob([p.keypoints], { type: 'application/gzip' })

async function refresh(uid: string | null): Promise<void> {
  try {
    const all = await idbGetAll<PendingUpload>()
    const ids = uid ? all.filter((p) => p.ownerId === uid).map((p) => p.attemptId) : []
    offlineStore.set((s) => ({ ...s, ids }))
  } catch {
    offlineStore.set((s) => ({ ...s, ids: [], unavailable: true }))
  }
}

/** Re-reads the pending count for the signed-in user. */
export function refreshPending(): Promise<void> {
  return refresh(getContext()?.uid ?? null)
}

/**
 * Saves a processed result, or keeps it for later when the network is the problem.
 * Returns 'saved' or 'queued'; any other failure (validation, permission, a deleted
 * attempt) is thrown as before, and nothing is kept.
 */
export async function saveOrQueue(ctx: QueueContext, r: ProcessedResult): Promise<'saved' | 'queued'> {
  try {
    await saveResult(ctx.db, r)
    return 'saved'
  } catch (e) {
    if (!isRetryableSaveError(e)) throw e
    if (!(await isGzip(r.keypoints))) throw e
    const entry: PendingUpload = {
      attemptId: r.attemptId,
      ownerId: ctx.uid,
      keypoints: await r.keypoints.arrayBuffer(),
      frameCount: r.frameCount,
      model: r.model,
      metrics: r.metrics,
      clipName: r.clipName ?? null,
      queuedAt: Date.now(),
      tries: 0,
    }
    try {
      await idbPut(entry)
    } catch {
      // No IndexedDB (private mode, blocked storage): report the network failure as before.
      offlineStore.set((s) => ({ ...s, unavailable: true }))
      throw e
    }
    await refresh(ctx.uid)
    return 'queued'
  }
}

export interface FlushResult {
  uploaded: string[]
  /** Dropped because retrying can't help (attempt deleted, permission, bad data). */
  dropped: string[]
  remaining: number
}

let flushing: Promise<FlushResult> | null = null

/** Uploads every pending result of the signed-in user, oldest first. One run at a time. */
export function flushQueue(): Promise<FlushResult> {
  if (!flushing) {
    flushing = runFlush().finally(() => {
      flushing = null
      offlineStore.set((s) => ({ ...s, flushing: false }))
    })
  }
  return flushing
}

async function runFlush(): Promise<FlushResult> {
  const ctx = getContext()
  const out: FlushResult = { uploaded: [], dropped: [], remaining: 0 }
  if (!ctx) return out
  let all: PendingUpload[]
  try {
    all = await idbGetAll<PendingUpload>()
  } catch {
    offlineStore.set((s) => ({ ...s, ids: [], unavailable: true }))
    return out
  }
  const mine = all.filter((p) => p.ownerId === ctx.uid).sort((a, b) => a.queuedAt - b.queuedAt)
  if (mine.length === 0) {
    offlineStore.set((s) => ({ ...s, ids: [], lastError: null }))
    return out
  }
  offlineStore.set((s) => ({ ...s, flushing: true }))
  let lastError: ApiError | null = null
  for (let i = 0; i < mine.length; i++) {
    const p = mine[i]
    // Signed out (or switched account) mid-run: stop, the entries are not this user's any more.
    if (getContext()?.uid !== ctx.uid) break
    try {
      await saveResult(ctx.db, { ...p, keypoints: toBlob(p) })
      await idbDelete(p.attemptId)
      out.uploaded.push(p.attemptId)
      uploadedListeners.forEach((l) => l(p.attemptId))
    } catch (e) {
      if (isRetryableSaveError(e)) {
        lastError = dataError(e)
        await idbPut({ ...p, tries: p.tries + 1 }).catch(() => undefined)
        // Still offline: the rest would fail the same way.
        out.remaining = mine.length - i
        break
      }
      await idbDelete(p.attemptId).catch(() => undefined)
      out.dropped.push(p.attemptId)
      // The attempt may be gone; if not, it shows as failed with a reason.
      await setAttemptStatus(ctx.db, p.attemptId, 'failed', dataError(e).message).catch(() => undefined)
    }
  }
  offlineStore.set((s) => ({ ...s, lastError }))
  await refresh(ctx.uid)
  return out
}

/** Forgets every kept result, whoever it belongs to (sign-out, delete all my data). */
export async function clearQueue(): Promise<void> {
  offlineStore.set((s) => ({ ...s, ids: [], lastError: null }))
  try {
    await idbClear()
  } catch {
    // Nothing could be stored either.
  }
}

let stopAuto: (() => void) | null = null

/** Retries when the browser says it is back online. Call once; returns the stop function. */
export function startAutoRetry(): () => void {
  if (stopAuto) return stopAuto
  if (typeof window === 'undefined') return () => undefined
  const onOnline = () => void flushQueue()
  window.addEventListener('online', onOnline)
  stopAuto = () => {
    window.removeEventListener('online', onOnline)
    stopAuto = null
  }
  return stopAuto
}
