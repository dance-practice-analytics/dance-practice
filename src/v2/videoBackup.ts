// Optional video backup (FR-3.2, FR-3.9; decision of 2026-11-17). Off unless the user
// turns on "Back up video to your account" in Import. Then, after a clip has been
// processed on this device, the original file goes to the private `videos` bucket at
// {owner_id}/{attempt_id}.{ext} (owner-only storage policies) and attempts.video_path
// points at it. Review and Compare play a backed-up clip from a short-lived signed URL,
// so no relinking is needed. The video is never sent to the language model.
//
// The free plan has 1 GB of storage and a 50 MB per-file cap, so a backup that would not
// fit is refused up front with a sentence that says why.

import { useEffect, useState, useSyncExternalStore } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { ApiError } from '../api/errors'
import { VIDEOS_BUCKET, type AttemptRow } from '../data/schema'
import { authStore, client } from './auth'
import { getClip, useClip } from './clips'
import { invalidate } from './data'
import { formatBytes } from './format'
import { onAttemptFinished, type PipelineStatus } from './pipeline'

/** Per-file cap of the bucket (free plan: 50 MB). */
export const VIDEO_MAX_BYTES = 50 * 1024 * 1024
/** Storage of the free plan. Keypoint files count against it too. */
export const STORAGE_BUDGET_BYTES = 1024 * 1024 * 1024

// ---------- pure helpers (tested) ----------

const TYPES: Record<string, string> = { mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', m4v: 'video/x-m4v' }

/** File extension and content type the bucket accepts; null when it isn't one of them. */
export function videoKind(file: { name: string; type: string }): { ext: string; contentType: string } | null {
  const ext = /\.([a-z0-9]+)$/i.exec(file.name)?.[1]?.toLowerCase() ?? ''
  if (TYPES[ext]) return { ext, contentType: TYPES[ext] }
  const fromType = Object.entries(TYPES).find(([, t]) => t === file.type)
  return fromType ? { ext: fromType[0], contentType: fromType[1] } : null
}

/** Object path in the videos bucket; the first folder is what the storage policy checks. */
export function videoBackupPath(uid: string, attemptId: string, ext: string): string {
  return `${uid}/${attemptId}.${ext}`
}

export interface StorageUsage {
  videoFiles: number
  videoBytes: number
  keypointBytes: number
}

export const usedBytes = (u: StorageUsage) => u.videoBytes + u.keypointBytes

/** '1.0 GB', '239.4 MB', '310 KB'. */
export function formatStorage(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`
  return formatBytes(bytes)
}

/**
 * Why a batch can't be backed up, or null when it fits. `files` are the videos to add.
 */
export function backupProblem(
  files: readonly { name: string; size: number; type: string }[],
  usage: StorageUsage | null,
): { title: string; detail: string } | null {
  const big = files.filter((f) => f.size > VIDEO_MAX_BYTES)
  if (big.length > 0) {
    return {
      title: big.length === 1 ? 'One clip is too large to back up' : `${big.length} clips are too large to back up`,
      detail: `Each video can be at most ${formatBytes(VIDEO_MAX_BYTES)}; ${big.map((f) => `${f.name} is ${formatBytes(f.size)}`).join(', ')}. Turn backup off to process them on this device only, or export a shorter or smaller copy.`,
    }
  }
  const odd = files.filter((f) => !videoKind(f))
  if (odd.length > 0) {
    return {
      title: 'This video type can’t be backed up',
      detail: `Backup takes MP4, MOV, M4V or WebM files (${odd.map((f) => f.name).join(', ')}). Turn backup off to process them on this device only.`,
    }
  }
  if (!usage) return null
  const adding = files.reduce((s, f) => s + f.size, 0)
  const after = usedBytes(usage) + adding
  if (after > STORAGE_BUDGET_BYTES) {
    return {
      title: 'Not enough storage for this backup',
      detail: `These videos need ${formatStorage(adding)}; your account already uses ${formatStorage(usedBytes(usage))} of about ${formatStorage(STORAGE_BUDGET_BYTES)}. Back up fewer clips, delete backed-up videos in Settings, or turn backup off.`,
    }
  }
  return null
}

// ---------- usage ----------

/** What this account stores: its videos (listed in its folder) and keypoint files (recorded sizes). */
export async function loadStorageUsage(db: SupabaseClient): Promise<StorageUsage> {
  const { data: auth } = await db.auth.getUser()
  const uid = auth.user?.id
  if (!uid) throw new ApiError(401, 'signed_out', 'You’re signed out.', 'Sign in again.')
  const [listed, keypoints] = await Promise.all([
    db.storage.from(VIDEOS_BUCKET).list(uid, { limit: 1000 }),
    db.from('attempt_keypoints').select('size_bytes'),
  ])
  if (listed.error) throw new ApiError(502, 'storage_unavailable', 'Storage use couldn’t be checked.', 'Check the connection and try again.')
  const files = (listed.data ?? []).filter((o) => o.id !== null)
  const videoBytes = files.reduce((s, o) => s + (Number((o.metadata as { size?: number } | null)?.size) || 0), 0)
  const keypointBytes = ((keypoints.data ?? []) as { size_bytes: number | null }[]).reduce((s, k) => s + (k.size_bytes ?? 0), 0)
  return { videoFiles: files.length, videoBytes, keypointBytes }
}

/** Reloads whenever `version` changes (pass the library data so it follows every invalidate). */
export function useStorageUsage(version: unknown): { data: StorageUsage | null; error: boolean; reload(): void } {
  const [data, setData] = useState<StorageUsage | null>(null)
  const [error, setError] = useState(false)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let live = true
    loadStorageUsage(client()).then(
      (u) => live && (setData(u), setError(false)),
      () => live && setError(true),
    )
    return () => {
      live = false
    }
  }, [version, tick])
  return { data, error, reload: () => setTick((n) => n + 1) }
}

// ---------- upload queue ----------

export type BackupStatus = 'waiting' | 'uploading' | 'done' | 'failed' | 'skipped'

export interface BackupItem {
  attemptId: string
  name: string
  size: number
  status: BackupStatus
  /** 0..1 while uploading. */
  fraction: number
  /** Dancer-safe sentence when failed or skipped. */
  reason: string | null
}

interface Job {
  file: File
  uid: string
}

let items: BackupItem[] = []
const jobs = new Map<string, Job>()
const listeners = new Set<() => void>()
/** Attempts whose processing is done, waiting for their upload. */
const ready = new Set<string>()
let running = false
let xhr: XMLHttpRequest | null = null

const notify = () => listeners.forEach((l) => l())
const patch = (id: string, change: Partial<BackupItem>) => {
  items = items.map((it) => (it.attemptId === id ? { ...it, ...change } : it))
  notify()
}

export function useBackups(): readonly BackupItem[] {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => items,
  )
}

/**
 * Marks attempts for backup. The upload of each starts once its processing has finished
 * (`done`); a clip whose processing fails or is cancelled is not backed up.
 */
export function queueBackups(list: readonly { attemptId: string; file: File; name: string }[]): void {
  const uid = authStore.get().user?.id
  if (!uid || list.length === 0) return
  const ids = new Set(list.map((j) => j.attemptId))
  items = [
    ...items.filter((it) => !ids.has(it.attemptId)),
    ...list.map((j) => ({ attemptId: j.attemptId, name: j.name, size: j.file.size, status: 'waiting' as const, fraction: 0, reason: null })),
  ]
  for (const j of list) jobs.set(j.attemptId, { file: j.file, uid })
  notify()
}

/** Tries a failed upload again. */
export function retryBackup(attemptId: string): void {
  if (!jobs.has(attemptId)) return
  patch(attemptId, { status: 'waiting', fraction: 0, reason: null })
  ready.add(attemptId)
  void pump()
}

export function clearFinishedBackups(): void {
  items = items.filter((it) => it.status === 'waiting' || it.status === 'uploading' || it.status === 'failed')
  for (const id of [...jobs.keys()]) if (!items.some((it) => it.attemptId === id)) jobs.delete(id)
  notify()
}

/** Drops everything; called on sign-out, delete all and delete account. */
export function resetBackups(): void {
  xhr?.abort()
  items = []
  jobs.clear()
  ready.clear()
  notify()
}

onAttemptFinished((id: string, status: PipelineStatus) => {
  if (!jobs.has(id) || !items.some((it) => it.attemptId === id && it.status === 'waiting')) return
  if (status === 'done') {
    ready.add(id)
    void pump()
  } else {
    patch(id, { status: 'skipped', reason: 'Not backed up: processing didn’t finish. Process the clip again with backup on.' })
    jobs.delete(id)
  }
})

if (typeof window !== 'undefined') {
  // A network failure is retried once the browser is back online.
  window.addEventListener('online', () => {
    for (const it of items) if (it.status === 'failed' && jobs.has(it.attemptId)) retryBackup(it.attemptId)
  })
}

async function pump(): Promise<void> {
  if (running) return
  running = true
  try {
    for (;;) {
      const next = items.find((it) => it.status === 'waiting' && ready.has(it.attemptId))
      if (!next) return
      ready.delete(next.attemptId)
      await uploadOne(next.attemptId)
    }
  } finally {
    running = false
  }
}

const FAIL_NETWORK = 'The upload stopped: no connection. It is tried again when you are back online.'
const FAIL_GENERIC = 'The video couldn’t be backed up. Your clip and its measurements are fine.'

async function uploadOne(id: string): Promise<void> {
  const job = jobs.get(id)
  if (!job) return
  const kind = videoKind(job.file)
  if (!kind || job.file.size > VIDEO_MAX_BYTES) {
    patch(id, { status: 'failed', reason: backupProblem([job.file], null)?.detail ?? FAIL_GENERIC })
    return
  }
  patch(id, { status: 'uploading', fraction: 0, reason: null })
  const db = client()
  const path = videoBackupPath(job.uid, id, kind.ext)
  try {
    const { data } = await db.auth.getSession()
    const token = data.session?.access_token
    if (!token || data.session?.user.id !== job.uid) throw new ApiError(401, 'signed_out', FAIL_GENERIC)
    await putObject(path, job.file, kind.contentType, token, (f) => patch(id, { fraction: f }))
    const res = await db.from('attempts').update({ video_path: path }).eq('id', id).select('id').maybeSingle()
    if (res.error || !res.data) throw new ApiError(res.status || 500, 'not_saved', FAIL_GENERIC)
    patch(id, { status: 'done', fraction: 1 })
    jobs.delete(id)
    invalidate()
  } catch (e) {
    const offline = (e instanceof ApiError && e.code === 'network') || (typeof navigator !== 'undefined' && navigator.onLine === false)
    const tooBig = e instanceof ApiError && e.status === 413
    patch(id, {
      status: 'failed',
      fraction: 0,
      reason: offline
        ? FAIL_NETWORK
        : tooBig
          ? `The storage refused this file: it is larger than ${formatBytes(VIDEO_MAX_BYTES)}, or the account is full.`
          : FAIL_GENERIC,
    })
  }
}

/** Storage upload with progress (supabase-js has none): POST to the object endpoint, upsert for retries. */
function putObject(path: string, file: File, contentType: string, token: string, progress: (f: number) => void): Promise<void> {
  const base = (import.meta.env.VITE_SUPABASE_URL as string).trim().replace(/\/$/, '')
  const key = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string).trim()
  return new Promise((resolve, reject) => {
    const req = new XMLHttpRequest()
    xhr = req
    req.open('POST', `${base}/storage/v1/object/${VIDEOS_BUCKET}/${path.split('/').map(encodeURIComponent).join('/')}`)
    req.setRequestHeader('Authorization', `Bearer ${token}`)
    req.setRequestHeader('apikey', key)
    req.setRequestHeader('x-upsert', 'true')
    req.setRequestHeader('Content-Type', contentType)
    req.setRequestHeader('cache-control', 'max-age=3600')
    req.upload.onprogress = (e) => e.lengthComputable && progress(e.loaded / e.total)
    req.onload = () => {
      xhr = null
      if (req.status >= 200 && req.status < 300) resolve()
      else reject(new ApiError(req.status, 'upload_failed', FAIL_GENERIC))
    }
    req.onerror = () => {
      xhr = null
      reject(new ApiError(0, 'network', FAIL_NETWORK))
    }
    req.onabort = () => {
      xhr = null
      reject(new ApiError(0, 'aborted', FAIL_GENERIC))
    }
    req.send(file)
  })
}

// ---------- playback ----------

/** A video to play: a local file of this tab, or a backed-up one (`objectUrl` null while its link loads). */
export interface AttemptVideo {
  objectUrl: string | null
  remote: boolean
}

const signed = new Map<string, { url: string; until: number }>()
const SIGNED_TTL_S = 60 * 60

async function signedUrl(path: string): Promise<string> {
  const hit = signed.get(path)
  if (hit && hit.until > Date.now() + 60_000) return hit.url
  const res = await client().storage.from(VIDEOS_BUCKET).createSignedUrl(path, SIGNED_TTL_S)
  if (res.error || !res.data?.signedUrl) throw res.error ?? new Error('no url')
  signed.set(path, { url: res.data.signedUrl, until: Date.now() + SIGNED_TTL_S * 1000 })
  return res.data.signedUrl
}

/**
 * The video of an attempt: the local file when it was picked in this tab, else the
 * backed-up copy, else null (Review / Compare then offer to choose the file again).
 */
export function useAttemptVideo(attempt: Pick<AttemptRow, 'id' | 'video_path'>): AttemptVideo | null {
  const local = useClip(attempt.id)
  const path = local ? null : attempt.video_path
  const [remote, setRemote] = useState<{ path: string; url: string | null; failed: boolean } | null>(null)
  useEffect(() => {
    if (!path) return
    let live = true
    setRemote({ path, url: null, failed: false })
    signedUrl(path).then(
      (url) => live && setRemote({ path, url, failed: false }),
      () => live && setRemote({ path, url: null, failed: true }),
    )
    return () => {
      live = false
    }
  }, [path])
  if (local) return { objectUrl: local.objectUrl, remote: false }
  if (!path) return null
  if (remote?.path === path && remote.failed) return null
  return { objectUrl: remote?.path === path ? remote.url : null, remote: true }
}

/** True when this attempt's video is in the tab or backed up. */
export function hasVideo(attempt: Pick<AttemptRow, 'id' | 'video_path'>): boolean {
  return !!getClip(attempt.id) || !!attempt.video_path
}

// ---------- delete ----------

/**
 * Deletes every backed-up video of this account and clears the attempts' video_path.
 * Keypoints, measurements and the local files are untouched.
 */
export async function deleteAllBackedUpVideos(db: SupabaseClient): Promise<{ files: number }> {
  const { data: auth } = await db.auth.getUser()
  const uid = auth.user?.id
  if (!uid) throw new ApiError(401, 'signed_out', 'You’re signed out.', 'Sign in again.')
  const listed = await db.storage.from(VIDEOS_BUCKET).list(uid, { limit: 1000 })
  if (listed.error) throw new ApiError(502, 'storage_unavailable', 'The backed-up videos couldn’t be listed.', 'Try again.')
  const paths = (listed.data ?? []).filter((o) => o.id !== null).map((o) => `${uid}/${o.name}`)
  if (paths.length > 0) {
    const removed = await db.storage.from(VIDEOS_BUCKET).remove(paths)
    if (removed.error) throw new ApiError(502, 'storage_unavailable', 'The backed-up videos couldn’t be deleted.', 'Try again.')
  }
  const cleared = await db.from('attempts').update({ video_path: null }).not('video_path', 'is', null).select('id')
  if (cleared.error) throw new ApiError(502, 'not_saved', 'The videos were deleted, but the library still lists them.', 'Try again.')
  signed.clear()
  return { files: paths.length }
}
