// Deleting the signed-in account's own data (FR-3.9.3, FR-3.9.4).
//
// Order: stored files first (keypoints, then clips), then rows, children before
// parents. Files go first because the cascade only covers tables: once an attempt
// row is gone nothing points at its files any more.
//
// Storage answers "removed nothing" in the same way for a file that was never there
// and for one it was not allowed to remove, so every removal is checked by listing
// the caller's folder afterwards. A file that is still there is reported in
// `failedObjects`, never swallowed.
//
// - Attempt and session scope: an attempt whose file could not be removed keeps its
//   rows (`keptAttempts`), so the clip stays visible and the delete can be run again.
// - All data: rows are deleted even if a file is left, and the next run finds the
//   file again by listing the folder.
//
// Every function can be run again: what is already gone counts as zero.
// RLS limits every statement to the caller's rows; each one also filters by the
// caller's uid, and only paths inside the caller's storage folder are ever sent.
//
// Not possible with the browser's key: removing the sign-in account itself and the
// profile row. `deleteAccount` asks the Edge Function `delete-account` to do that.

import { FunctionsFetchError, FunctionsHttpError, type SupabaseClient } from '@supabase/supabase-js'
import {
  CONFIRM_WORD as ACCOUNT_CONFIRM_WORD,
  FAILURES as ACCOUNT_FAILURES,
  FUNCTION_NAME as ACCOUNT_FUNCTION,
  isDeleteAccountReport,
  type DeleteAccountReport,
  type DeleteAccountRequest,
  type FailureCode as AccountFailureCode,
} from '../../supabase/functions/delete-account/contract'
import { ApiError } from '../api/errors'
import { guardAs, requireUid, selectOwn } from './exportData'
import { dataError, keypointsPath } from './repo'
import { KEYPOINTS_BUCKET, VIDEOS_BUCKET, type AttemptRow } from './schema'

/** Tables the browser may delete from, in the order they are emptied. */
export const DELETE_ORDER = [
  'feedback',
  'attempt_metrics',
  'attempt_keypoints',
  'attempts',
  'sessions',
  'consents',
  'subjects',
] as const
export type DeleteTable = (typeof DELETE_ORDER)[number]

export type StorageBucket = typeof KEYPOINTS_BUCKET | typeof VIDEOS_BUCKET

export interface FailedObject {
  bucket: StorageBucket
  /** Object path; a path ending in '/' means the folder could not be checked. */
  path: string
  /** ApiError code, or 'not_removed' / 'outside_own_folder'. */
  code: string
  message: string
}

export interface DeleteReport {
  scope: 'attempt' | 'session' | 'all'
  /** Rows deleted per table in this run. */
  rows: Record<DeleteTable, number>
  /** Stored files removed per bucket in this run. */
  objects: Record<StorageBucket, number>
  failedObjects: FailedObject[]
  /** Attempts left in place because one of their files could not be removed. */
  keptAttempts: string[]
  /** True when nothing in the scope is left (and nothing failed). */
  complete: boolean
  /** Scope 'all' only: what the browser cannot remove. */
  remaining: string[]
}

/** What `deleteAllMyData` leaves behind; only `deleteAccount` (server side) removes them. */
export const ACCOUNT_REMAINS = ['sign-in account', 'profile'] as const

const DELETE_FAILED: [string, string, string] = ['delete_failed', 'That couldn’t be deleted.', 'Try again in a moment.']

const emptyReport = (scope: DeleteReport['scope']): DeleteReport => ({
  scope,
  rows: { feedback: 0, attempt_metrics: 0, attempt_keypoints: 0, attempts: 0, sessions: 0, consents: 0, subjects: 0 },
  objects: { [KEYPOINTS_BUCKET]: 0, [VIDEOS_BUCKET]: 0 },
  failedObjects: [],
  keptAttempts: [],
  complete: false,
  remaining: [],
})

// ---------- storage ----------

interface StorageResult {
  data: unknown
  error: unknown
}

/** Attempt id of a stored file: {uid}/{attempt_id}.json.gz or {uid}/{attempt_id}.{ext}. */
const attemptOf = (path: string) => (path.split('/').pop() ?? '').split('.')[0]

/** Paths in the caller's folder of a bucket, or the mapped error when it can't be listed. */
async function listFolder(client: SupabaseClient, bucket: StorageBucket, uid: string): Promise<string[] | ApiError> {
  const paths: string[] = []
  try {
    for (let offset = 0; ; offset += 1000) {
      const res = (await client.storage.from(bucket).list(uid, { limit: 1000, offset })) as StorageResult
      if (res.error) return dataError(res.error)
      const entries = (res.data ?? []) as { name?: string; id?: string | null }[]
      // Entries without an id are folders or placeholders, not files.
      for (const e of entries) if (e.name && e.id !== null) paths.push(`${uid}/${e.name}`)
      if (entries.length < 1000) return paths
    }
  } catch (e) {
    return dataError(e)
  }
}

interface Cleared {
  removed: number
  failed: FailedObject[]
  /** The folder could not be listed afterwards, so nothing is confirmed. */
  unchecked: boolean
}

/**
 * Removes the caller's files in one bucket: the `known` paths plus whatever the
 * folder holds that `wanted` accepts (files left by an earlier, interrupted run).
 */
async function clearStored(
  client: SupabaseClient,
  bucket: StorageBucket,
  uid: string,
  known: string[],
  wanted: (path: string) => boolean,
): Promise<Cleared> {
  const out: Cleared = { removed: 0, failed: [], unchecked: false }
  const own = `${uid}/`
  const expected = new Set<string>()
  for (const path of known) {
    if (path.startsWith(own) && !path.includes('..')) expected.add(path)
    else out.failed.push({ bucket, path, code: 'outside_own_folder', message: 'This file is not in your storage folder, so it was left alone.' })
  }
  const before = await listFolder(client, bucket, uid)
  // What is really stored, when the folder can be listed (most attempts have no clip,
  // and a queued one has no keypoints yet); otherwise the paths the rows point at.
  const targets = before instanceof ApiError ? expected : new Set(before.filter((p) => expected.has(p) || wanted(p)))
  if (targets.size === 0 && !(before instanceof ApiError)) return out

  const all = [...targets]
  const refused = new Set<string>()
  for (let i = 0; i < all.length; i += 100) {
    const chunk = all.slice(i, i + 100)
    let error: unknown = null
    try {
      const res = (await client.storage.from(bucket).remove(chunk)) as StorageResult
      error = res.error
      if (!error && Array.isArray(res.data)) out.removed += res.data.length
    } catch (e) {
      error = e
    }
    if (error) {
      const mapped = dataError(error)
      for (const path of chunk) {
        refused.add(path)
        out.failed.push({ bucket, path, code: mapped.code, message: mapped.message })
      }
    }
  }

  const after = await listFolder(client, bucket, uid)
  if (after instanceof ApiError) {
    out.unchecked = true
    out.failed.push({ bucket, path: own, code: after.code, message: 'Your stored files couldn’t be checked after the delete.' })
    return out
  }
  for (const path of after) {
    if (wanted(path) && !refused.has(path)) {
      out.failed.push({ bucket, path, code: 'not_removed', message: 'This file is still stored.' })
    }
  }
  return out
}

/** Both buckets, keypoints first. Returns the attempts that still have a file. */
async function clearBuckets(
  client: SupabaseClient,
  uid: string,
  attempts: Pick<AttemptRow, 'id' | 'video_path'>[],
  report: DeleteReport,
  wanted: (path: string) => boolean,
): Promise<{ stuck: Set<string>; unchecked: boolean }> {
  const stuck = new Set<string>()
  let unchecked = false
  const known: Record<StorageBucket, string[]> = {
    [KEYPOINTS_BUCKET]: attempts.map((a) => keypointsPath(uid, a.id)),
    [VIDEOS_BUCKET]: attempts.map((a) => a.video_path).filter((p): p is string => !!p),
  }
  for (const bucket of [KEYPOINTS_BUCKET, VIDEOS_BUCKET] as const) {
    const cleared = await clearStored(client, bucket, uid, known[bucket], wanted)
    report.objects[bucket] += cleared.removed
    report.failedObjects.push(...cleared.failed)
    unchecked ||= cleared.unchecked
    for (const f of cleared.failed) if (!f.path.endsWith('/')) stuck.add(attemptOf(f.path))
  }
  return { stuck, unchecked }
}

// ---------- rows ----------

/** Deletes the caller's rows of a table, optionally narrowed to some ids. Returns how many went. */
async function deleteRows(
  client: SupabaseClient,
  table: DeleteTable,
  uid: string,
  where?: [col: string, ids: string[]],
): Promise<number> {
  const run = async (ids?: string[]) => {
    let q = client.from(table).delete({ count: 'exact' }).eq('owner_id', uid)
    if (where && ids) q = q.in(where[0], ids)
    const res = await q
    if (res.error) throw dataError(res.error, undefined, res.status)
    return res.count ?? 0
  }
  if (!where) return run()
  let n = 0
  // In groups, to keep the request URL short.
  for (let i = 0; i < where[1].length; i += 100) n += await run(where[1].slice(i, i + 100))
  return n
}

async function deleteAttemptRows(client: SupabaseClient, uid: string, ids: string[], report: DeleteReport): Promise<void> {
  if (ids.length === 0) return
  // The cascade would take the children too; deleting them here gives the counts.
  report.rows.feedback += await deleteRows(client, 'feedback', uid, ['attempt_id', ids])
  report.rows.attempt_metrics += await deleteRows(client, 'attempt_metrics', uid, ['attempt_id', ids])
  report.rows.attempt_keypoints += await deleteRows(client, 'attempt_keypoints', uid, ['attempt_id', ids])
  report.rows.attempts += await deleteRows(client, 'attempts', uid, ['id', ids])
}

// ---------- public API ----------

/**
 * Deletes one attempt with its keypoints, metrics, practice notes and any stored clip
 * (FR-3.9.3). An attempt that is already gone gives a report of zeros, after removing
 * any file an earlier run left behind.
 */
export function deleteAttemptData(client: SupabaseClient, attemptId: string): Promise<DeleteReport> {
  return guardAs(DELETE_FAILED, async () => {
    const uid = await requireUid(client)
    const report = emptyReport('attempt')
    const found = await selectOwn<Pick<AttemptRow, 'id' | 'video_path'>>(client, 'attempts', 'id, video_path', uid, ['id'], [
      'id',
      attemptId,
    ])
    const attempts = found.length ? found : [{ id: attemptId, video_path: null }]
    const { stuck, unchecked } = await clearBuckets(client, uid, attempts, report, (p) => attemptOf(p) === attemptId)
    if (stuck.size > 0 || unchecked) {
      if (found.length) report.keptAttempts = [attemptId]
      return report
    }
    await deleteAttemptRows(client, uid, found.map((a) => a.id), report)
    report.complete = report.failedObjects.length === 0
    return report
  })
}

/**
 * Deletes a session with all its attempts and their stored files. Attempts whose
 * files could not be removed stay, and so does the session; run it again to finish.
 * The session's subject is not touched.
 */
export function deleteSessionData(client: SupabaseClient, sessionId: string): Promise<DeleteReport> {
  return guardAs(DELETE_FAILED, async () => {
    const uid = await requireUid(client)
    const report = emptyReport('session')
    const attempts = await selectOwn<Pick<AttemptRow, 'id' | 'video_path'>>(
      client,
      'attempts',
      'id, video_path',
      uid,
      ['created_at', 'id'],
      ['session_id', sessionId],
    )
    const ids = new Set(attempts.map((a) => a.id))
    const { stuck, unchecked } =
      attempts.length > 0
        ? await clearBuckets(client, uid, attempts, report, (p) => ids.has(attemptOf(p)))
        : { stuck: new Set<string>(), unchecked: false }
    const kept = attempts.filter((a) => unchecked || stuck.has(a.id)).map((a) => a.id)
    report.keptAttempts = kept
    await deleteAttemptRows(client, uid, attempts.filter((a) => !kept.includes(a.id)).map((a) => a.id), report)
    if (kept.length === 0) {
      report.rows.sessions += await deleteRows(client, 'sessions', uid, ['id', [sessionId]])
      report.complete = report.failedObjects.length === 0
    }
    return report
  })
}

/**
 * Deletes everything the signed-in account has stored: every file in its folders of
 * the `keypoints` and `videos` buckets, then its rows in DELETE_ORDER (practice
 * notes, metrics, keypoint records, attempts, sessions, consents, subjects).
 *
 * It does not remove the sign-in account or the profile row (`remaining`); the
 * browser is not allowed to. Consent records go too, so the app asks again if the
 * account is used afterwards.
 */
export function deleteAllMyData(client: SupabaseClient): Promise<DeleteReport> {
  return guardAs(DELETE_FAILED, async () => {
    const uid = await requireUid(client)
    const report = emptyReport('all')
    report.remaining = [...ACCOUNT_REMAINS]
    const attempts = await selectOwn<Pick<AttemptRow, 'id' | 'video_path'>>(client, 'attempts', 'id, video_path', uid, [
      'created_at',
      'id',
    ])
    await clearBuckets(client, uid, attempts, report, () => true)
    for (const table of DELETE_ORDER) report.rows[table] += await deleteRows(client, table, uid)
    report.complete = report.failedObjects.length === 0
    return report
  })
}

// ---------- the account itself ----------

export type { DeleteAccountReport }

const accountFailure = (code: AccountFailureCode, status?: number): ApiError => {
  const f = ACCOUNT_FAILURES[code]
  return new ApiError(status || f.status, code, f.message, f.recovery)
}

const OFFLINE_ACCOUNT = new ApiError(0, 'offline', 'You’re offline, so nothing was deleted.', 'Reconnect and try again.')

/** The function's error body, or the platform's answer when there is none of ours. */
export function accountDeletionError(status: number, body: unknown): ApiError {
  const error = typeof body === 'object' && body !== null ? (body as { error?: Record<string, unknown> }).error : undefined
  const code = error?.code
  // The copy comes from the shared table, never from the response text.
  if (typeof code === 'string' && code in ACCOUNT_FAILURES) return accountFailure(code as AccountFailureCode, status)
  if (status === 401 || status === 403) return accountFailure('unauthorized', status)
  if (status === 404) return accountFailure('not_configured', status)
  return accountFailure('delete_failed', status)
}

/**
 * Deletes the signed-in account through the Edge Function `delete-account`: stored
 * files, every row (cascade from auth.users) and the auth user. The function holds the
 * service-role key; the browser only sends its own access token and the typed word.
 * Resolves with the function's report; the caller then signs out locally.
 */
export async function deleteAccount(client: SupabaseClient, typed: string): Promise<DeleteAccountReport> {
  if (typed.trim() !== ACCOUNT_CONFIRM_WORD) throw accountFailure('not_confirmed')
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw OFFLINE_ACCOUNT
  const body: DeleteAccountRequest = { confirm: ACCOUNT_CONFIRM_WORD }
  let data: unknown
  try {
    const res = await client.functions.invoke(ACCOUNT_FUNCTION, { body })
    if (res.error) throw res.error
    data = res.data
  } catch (e) {
    if (e instanceof FunctionsHttpError) {
      const res = e.context as Response
      let payload: unknown = null
      try {
        payload = await res.json()
      } catch {
        payload = null
      }
      throw accountDeletionError(res.status, payload)
    }
    if (e instanceof FunctionsFetchError && typeof navigator !== 'undefined' && navigator.onLine === false) throw OFFLINE_ACCOUNT
    throw new ApiError(0, 'network', 'Can’t reach the server right now, so nothing was deleted.', 'Check your connection and try again.')
  }
  // A 2xx without a report should not happen; the account may be gone, so don't claim either way.
  if (!isDeleteAccountReport(data)) {
    throw new ApiError(500, 'unexpected_response', 'The server gave an unexpected answer.', 'Sign in again to check whether the account still exists.')
  }
  return data
}
