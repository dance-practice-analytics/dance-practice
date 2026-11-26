// Typed repository over Supabase for the import flow (FR-3.2.x, FR-3.9.3).
// Every function takes the client, so tests can pass a fake and the screens pass
// `supabase` from src/api/supabase.ts. Only rows, gzipped keypoints and metrics are
// sent from here: there is no code path that uploads a clip or a frame.
// Failures leave as ApiError with copy that is safe to show; raw Postgres or
// Storage messages never reach the caller.

import type { SupabaseClient } from '@supabase/supabase-js'
import { ApiError } from '../api/errors'
import { clipNumberOrNull, deidentifiedClipName, parseClipName } from './clipFile'
import {
  ATTEMPT_STATUSES,
  CAMERA_VIEWS,
  CONSENT_SCOPES,
  CONSENT_VERSION,
  DEFAULT_POSE_MODEL,
  KEYPOINTS_BUCKET,
  KEYPOINTS_MAX_BYTES,
  NOTE_MAX_CHARS,
  SUBJECT_CODE_RE,
  VIDEOS_BUCKET,
  type AttemptKeypointsRow,
  type AttemptMetricsInsert,
  type AttemptMetricsRow,
  type AttemptRow,
  type AttemptStatus,
  type CameraView,
  type ConsentRow,
  type ConsentScope,
  type SessionInsert,
  type SessionRow,
  type StudyAttemptInsert,
  type SubjectRow,
} from './schema'

// ---------- errors ----------

type Copy = [message: string, recovery: string]

interface ErrorCopy {
  duplicate?: Copy
  notFound?: Copy
}

interface Failure {
  code?: unknown
  status?: unknown
  statusCode?: unknown
  message?: unknown
}

const NOT_SIGNED_IN: Copy = ['You’re not signed in.', 'Sign in and try again.']

/**
 * Supabase (Postgres, Storage, fetch) failure → dancer-safe ApiError.
 * `httpStatus` is the status of the response when the error object has none.
 */
export function dataError(e: unknown, copy: ErrorCopy = {}, httpStatus?: number): ApiError {
  if (e instanceof ApiError) return e
  const f = (e && typeof e === 'object' ? e : {}) as Failure
  const code = typeof f.code === 'string' ? f.code : ''
  const text = typeof f.message === 'string' ? f.message : ''
  // Storage reports the real status in statusCode and often 400 in status.
  const status = Number(f.statusCode) || Number(f.status) || httpStatus || 0

  if (status === 401 || code === 'PGRST301' || /\bjwt\b/i.test(text)) {
    return new ApiError(401, 'not_signed_in', ...NOT_SIGNED_IN)
  }
  // Postgres codes go first: a missing parent row (23503) also answers 409.
  if (code === 'PGRST116' || code === '23503') {
    const [message, recovery] = copy.notFound ?? ['That item is no longer here.', 'Refresh the list and try again.']
    return new ApiError(404, 'not_found', message, recovery)
  }
  if (code === '23505' || (status === 409 && !code)) {
    const [message, recovery] = copy.duplicate ?? ['That is already saved.', 'Refresh the list to see it.']
    return new ApiError(409, 'duplicate', message, recovery)
  }
  if (code === '42501' || status === 403) {
    return new ApiError(
      403,
      'permission',
      'This account can’t change that item.',
      'Check that you’re signed in with the account that imported it.',
    )
  }
  if (status === 404 || status === 406) {
    const [message, recovery] = copy.notFound ?? ['That item is no longer here.', 'Refresh the list and try again.']
    return new ApiError(404, 'not_found', message, recovery)
  }
  if (status === 413 || /maximum allowed size|too large/i.test(text)) {
    return new ApiError(
      413,
      'too_large',
      'The pose data for this clip is larger than the storage limit.',
      'Trim the clip to the movement and process it again.',
    )
  }
  if (status === 402 || status === 507 || /quota/i.test(text)) {
    return new ApiError(
      507,
      'storage_quota',
      'The project storage is full.',
      'Delete clips you no longer need, then try again.',
    )
  }
  if (code === '23514' || code === '23502' || code === '22P02' || status === 422) {
    return new ApiError(422, 'invalid', 'Some of that information can’t be saved as entered.', 'Check the fields and try again.')
  }
  if (status === 429) return new ApiError(429, 'rate_limited', 'Too many requests.', 'Wait a minute and try again.')

  const fetchFailed = /fetch|network|load failed|timed? ?out/i.test(text)
  if (status >= 500 || fetchFailed || (status === 0 && !(e instanceof Error))) {
    return new ApiError(status, 'network', 'Can’t reach the server right now.', 'Check your connection and try again.')
  }
  return new ApiError(status, 'data_error', 'That didn’t save.', 'Try again in a moment.')
}

interface Result {
  data: unknown
  error: unknown
  status?: number
}

function unwrap<T>(res: Result, copy?: ErrorCopy): T {
  if (res.error) throw dataError(res.error, copy, res.status)
  return res.data as T
}

/** Anything thrown (a dropped connection throws instead of returning an error) is mapped too. */
async function guard<T>(fn: () => Promise<T>, copy?: ErrorCopy): Promise<T> {
  try {
    return await fn()
  } catch (e) {
    throw dataError(e, copy)
  }
}

/** The signed-in user id, read from the local session (no network). */
async function requireUid(client: SupabaseClient): Promise<string> {
  const { data, error } = await client.auth.getSession()
  const uid = data?.session?.user?.id
  if (error || !uid) throw new ApiError(401, 'not_signed_in', ...NOT_SIGNED_IN)
  return uid
}

const invalid = (code: string, message: string, recovery: string) => new ApiError(422, code, message, recovery)

// ---------- subjects ----------

const SUBJECT_COLS = 'id, owner_id, subject_code, notes, created_at'

export function isSubjectCode(code: string): boolean {
  return SUBJECT_CODE_RE.test(code)
}

export function listSubjects(client: SupabaseClient): Promise<SubjectRow[]> {
  return guard(async () => {
    await requireUid(client)
    return unwrap<SubjectRow[]>(await client.from('subjects').select(SUBJECT_COLS).order('subject_code'))
  })
}

/** Returns the subject with this code, creating it the first time. Codes only, never names. */
export function ensureSubject(client: SupabaseClient, code: string): Promise<SubjectRow> {
  return guard(async () => {
    const subjectCode = code.trim().toUpperCase()
    if (!isSubjectCode(subjectCode)) {
      throw invalid('invalid_subject_code', 'Subject codes look like S01.', 'Enter the letter S and two digits.')
    }
    await requireUid(client)
    const find = async () =>
      unwrap<SubjectRow | null>(
        await client.from('subjects').select(SUBJECT_COLS).eq('subject_code', subjectCode).maybeSingle(),
      )

    const existing = await find()
    if (existing) return existing

    const created = await client.from('subjects').insert({ subject_code: subjectCode }).select(SUBJECT_COLS).single()
    if (!created.error) return created.data as SubjectRow
    // Two imports of the same subject at once: the other one won, so use its row.
    if ((created.error as Failure).code === '23505') {
      const row = await find()
      if (row) return row
    }
    throw dataError(created.error, undefined, created.status)
  })
}

// ---------- consents ----------

const CONSENT_COLS = 'id, owner_id, subject_id, scope, form_reference, granted_on, revoked_on, created_at'

const isConsentScope = (scope: string): scope is ConsentScope => (CONSENT_SCOPES as readonly string[]).includes(scope)

/** The account's own consent rows (not the per-subject paper forms), oldest first. */
export function listConsents(client: SupabaseClient): Promise<ConsentRow[]> {
  return guard(async () => {
    await requireUid(client)
    const rows = unwrap<ConsentRow[]>(await client.from('consents').select(CONSENT_COLS).order('created_at'))
    return rows.filter((r) => r.subject_id == null)
  })
}

/** Scopes with a row that has not been revoked. */
export function activeConsents(
  rows: Pick<ConsentRow, 'scope' | 'subject_id' | 'revoked_on'>[],
): Set<ConsentScope> {
  const out = new Set<ConsentScope>()
  for (const r of rows) if (r.subject_id == null && r.revoked_on == null && isConsentScope(r.scope)) out.add(r.scope)
  return out
}

/**
 * Records one row per accepted scope with the consent text version (FR-3.1.6); the
 * time is the row's created_at. A scope that is already active is left as it is, and
 * one that was revoked gets a new row, so the history stays readable.
 */
export function grantConsents(
  client: SupabaseClient,
  scopes: readonly ConsentScope[],
  version: string = CONSENT_VERSION,
): Promise<ConsentRow[]> {
  return guard(async () => {
    const wanted = [...new Set(scopes)]
    if (wanted.some((s) => !isConsentScope(s))) {
      throw invalid('invalid_consent', 'That choice isn’t known.', 'Reload the page and try again.')
    }
    const current = await listConsents(client)
    const active = activeConsents(current)
    const missing = wanted.filter((s) => !active.has(s))
    if (missing.length === 0) return current
    // Field by field: no owner_id (the database sets it) and no subject (account-level).
    const rows = missing.map((scope) => ({ scope, form_reference: version, subject_id: null }))
    const created = unwrap<ConsentRow[]>(await client.from('consents').insert(rows).select(CONSENT_COLS))
    return [...current, ...created]
  })
}

/** Withdraws a scope from today on. The rows stay, with revoked_on set. */
export function revokeConsent(client: SupabaseClient, scope: ConsentScope): Promise<ConsentRow[]> {
  return guard(async () => {
    const current = await listConsents(client)
    const ids = current.filter((r) => r.scope === scope && r.revoked_on == null).map((r) => r.id)
    if (ids.length === 0) return current
    const revoked_on = new Date().toISOString().slice(0, 10)
    const changed = unwrap<ConsentRow[]>(
      await client.from('consents').update({ revoked_on }).in('id', ids).select(CONSENT_COLS),
    )
    const byId = new Map(changed.map((r) => [r.id, r]))
    return current.map((r) => byId.get(r.id) ?? r)
  })
}

// ---------- sessions ----------

const SESSION_COLS = 'id, owner_id, subject_id, movement_type, title, recorded_on, camera_view, note, created_at'

/**
 * A note as it is saved: trimmed, empty → null. Longer than the column allows is
 * refused rather than cut, so the dancer's words are never silently lost.
 */
export function normaliseNote(note: string | null | undefined): string | null {
  const text = (note ?? '').replace(/\r\n?/g, '\n').trim()
  if (!text) return null
  if ([...text].length > NOTE_MAX_CHARS) {
    throw invalid('note_too_long', `Notes can be up to ${NOTE_MAX_CHARS} characters.`, 'Shorten the note and try again.')
  }
  return text
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function validDate(day: string | null | undefined): string | null {
  if (day == null || day === '') return null
  const d = new Date(`${day}T00:00:00Z`)
  if (!DATE_RE.test(day) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== day) {
    throw invalid('invalid_date', 'That date isn’t valid.', 'Pick the day the clips were recorded.')
  }
  return day
}

export interface SessionSummary extends SessionRow {
  subject_code: string | null
  attempt_count: number
}

const SESSION_GONE: ErrorCopy = {
  notFound: ['That session is no longer here.', 'Refresh the library and try again.'],
}

export function createSession(client: SupabaseClient, input: SessionInsert): Promise<SessionRow> {
  return guard(async () => {
    await requireUid(client)
    // Built field by field so nothing extra (an owner_id, say) rides along.
    const row: SessionInsert = {
      movement_type: input.movement_type,
      subject_id: input.subject_id ?? null,
      title: input.title?.trim() || null,
      recorded_on: validDate(input.recorded_on),
      camera_view: input.camera_view ?? null,
      note: normaliseNote(input.note),
    }
    return unwrap<SessionRow>(await client.from('sessions').insert(row).select(SESSION_COLS).single(), {
      notFound: ['That subject is no longer here.', 'Pick the subject again.'],
    })
  })
}

/** Newest first, with the subject code and the number of attempts in each session. */
export function listSessions(client: SupabaseClient): Promise<SessionSummary[]> {
  return guard(async () => {
    await requireUid(client)
    type Joined = SessionRow & {
      subjects?: { subject_code: string } | null
      attempts?: { count: number }[] | null
    }
    const rows = unwrap<Joined[]>(
      await client
        .from('sessions')
        .select(`${SESSION_COLS}, subjects(subject_code), attempts(count)`)
        .order('created_at', { ascending: false }),
    )
    return rows.map(({ subjects, attempts, ...session }) => ({
      ...session,
      subject_code: subjects?.subject_code ?? null,
      attempt_count: attempts?.[0]?.count ?? 0,
    }))
  })
}

/**
 * Changes the session's note, date (FR-3.2.2) and / or camera position (a correction of what
 * was set at import; the measurements don't depend on it). Only the fields given are sent.
 */
export function updateSession(
  client: SupabaseClient,
  sessionId: string,
  change: { note?: string | null; recorded_on?: string | null; camera_view?: CameraView | null },
): Promise<SessionRow> {
  return guard(async () => {
    await requireUid(client)
    const row: Partial<Pick<SessionRow, 'note' | 'recorded_on' | 'camera_view'>> = {}
    if ('note' in change) row.note = normaliseNote(change.note)
    if ('recorded_on' in change) row.recorded_on = validDate(change.recorded_on)
    if ('camera_view' in change) {
      const v = change.camera_view ?? null
      if (v !== null && !(CAMERA_VIEWS as readonly string[]).includes(v)) {
        throw invalid('invalid_camera_view', 'That camera position isn’t one of front, side or diagonal.', 'Pick one of the three.')
      }
      row.camera_view = v
    }
    const saved = unwrap<SessionRow | null>(
      await client.from('sessions').update(row).eq('id', sessionId).select(SESSION_COLS).maybeSingle(),
      SESSION_GONE,
    )
    if (!saved) throw dataError({ code: 'PGRST116' }, SESSION_GONE)
    return saved
  }, SESSION_GONE)
}

/** Deletes a session, its attempts and their stored keypoints (and clips, for user uploads). */
export function deleteSession(client: SupabaseClient, sessionId: string): Promise<void> {
  return guard(async () => {
    const uid = await requireUid(client)
    const attempts = unwrap<Pick<AttemptRow, 'id' | 'video_path'>[]>(
      await client.from('attempts').select('id, video_path').eq('session_id', sessionId),
    )
    await removeStored(client, uid, attempts)
    const gone = unwrap<{ id: string }[]>(await client.from('sessions').delete().eq('id', sessionId).select('id'))
    if (gone.length === 0) throw dataError({ code: 'PGRST116' }, SESSION_GONE)
  }, SESSION_GONE)
}

// ---------- attempts ----------

export const ATTEMPT_COLS =
  'id, owner_id, session_id, source, label, clip_name, clip_number, note, video_path, video_sha256, duration_s, fps, status, error, is_reference, trim_start_s, trim_end_s, created_at'

const ATTEMPT_GONE: ErrorCopy = {
  notFound: ['That clip is no longer in your library.', 'Refresh the list and try again.'],
}
const DUPLICATE_CLIP: Copy = ['This clip is already in your library.', 'Open the earlier import, or delete it to import again.']

/** What the import screen knows about one picked study clip. No bytes, no path. */
export interface StudyClipInput {
  /** The local file name. Only `deidentifiedClipName` of it is stored. */
  clip_name: string
  /** Clip number in the dataset (FR-3.2.4); read from the name when not given. */
  clip_number?: number | null
  /** Lower-case hex from `sha256Hex`. */
  video_sha256: string
  duration_s: number | null
  /** Unknown until the pose step has decoded the clip. */
  fps?: number | null
  label?: string | null
  /** FR-3.2.7: process only this part (seconds of the original clip); null = whole clip. */
  trim?: { startS: number; endS: number } | null
}

export type StudyAttemptResult =
  | { clip: StudyClipInput; outcome: 'created'; attempt: AttemptRow }
  /** `existing_attempt_id` is the earlier import when it could be found. */
  | { clip: StudyClipInput; outcome: 'duplicate'; existing_attempt_id: string | null; error: ApiError }
  | { clip: StudyClipInput; outcome: 'failed'; error: ApiError }

const finiteOrNull = (n: number | null | undefined) => (typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : null)

/**
 * The trim columns of a clip (FR-3.2.7). Anything unusable is stored as "whole clip"
 * rather than failing the import; the form validates first (`trimProblem`).
 */
export function storedTrim(trim: StudyClipInput['trim']): { trim_start_s: number | null; trim_end_s: number | null } {
  const start = finiteOrNull(trim?.startS)
  const end = finiteOrNull(trim?.endS)
  if (start === null || end === null || end <= start) return { trim_start_s: null, trim_end_s: null }
  return { trim_start_s: start, trim_end_s: end }
}

/** The trim of a stored attempt, in the shape the pose step takes; null = whole clip. */
export function attemptTrim(row: Pick<AttemptRow, 'trim_start_s' | 'trim_end_s'>): { startS: number; endS: number } | null {
  const { trim_start_s, trim_end_s } = storedTrim({ startS: row.trim_start_s ?? NaN, endS: row.trim_end_s ?? NaN })
  return trim_start_s === null || trim_end_s === null ? null : { startS: trim_start_s, endS: trim_end_s }
}

/**
 * Clip name and number as they may be stored (FR-3.2.5): the local file name never
 * leaves the device, only a label rebuilt from the subject code and clip number.
 */
export function storedClipFields(clip: Pick<StudyClipInput, 'clip_name' | 'clip_number'>): {
  clip_name: string
  clip_number: number | null
} {
  const clip_number = clipNumberOrNull(clip.clip_number) ?? clipNumberOrNull(parseClipName(clip.clip_name ?? '').take)
  return { clip_name: deidentifiedClipName(clip.clip_name ?? '', clip_number), clip_number }
}

function studyRow(sessionId: string, clip: StudyClipInput, sha: string): StudyAttemptInsert {
  // Written out field by field. video_path starts null; only the opt-in backup sets it, after the upload.
  return {
    session_id: sessionId,
    source: 'study_dataset',
    label: clip.label?.trim() || null,
    ...storedClipFields(clip),
    video_path: null,
    video_sha256: sha,
    duration_s: finiteOrNull(clip.duration_s),
    fps: finiteOrNull(clip.fps),
    ...storedTrim(clip.trim),
    status: 'queued',
  }
}

/**
 * One attempt row per study clip (FR-3.2.3, FR-3.2.4). The clips stay on the device.
 * Returns one result per clip, in the same order: a clip that was imported before
 * (same SHA-256) is reported as a duplicate and the rest are still created.
 */
export function createStudyAttempts(
  client: SupabaseClient,
  sessionId: string,
  clips: StudyClipInput[],
): Promise<StudyAttemptResult[]> {
  return guard(async () => {
    await requireUid(client)
    const results = new Array<StudyAttemptResult>(clips.length)
    const duplicate = () => new ApiError(409, 'duplicate_clip', ...DUPLICATE_CLIP)

    // 1. Validate and spot the same file picked twice in this batch.
    const firstIndex = new Map<string, number>()
    const repeats: { index: number; of: number }[] = []
    const pending: { index: number; sha: string }[] = []
    clips.forEach((clip, index) => {
      const sha = String(clip.video_sha256 ?? '').trim().toLowerCase()
      if (!/^[0-9a-f]{64}$/.test(sha)) {
        const error = invalid('invalid_clip', 'This clip couldn’t be read completely.', 'Pick the file again.')
        results[index] = { clip, outcome: 'failed', error }
      } else if (firstIndex.has(sha)) {
        repeats.push({ index, of: firstIndex.get(sha)! })
      } else {
        firstIndex.set(sha, index)
        pending.push({ index, sha })
      }
    })

    // 2. Clips this account imported before. Asked in small groups to keep the URL short.
    const known = new Map<string, string>()
    for (let i = 0; i < pending.length; i += 40) {
      const shas = pending.slice(i, i + 40).map((p) => p.sha)
      const rows = unwrap<{ id: string; video_sha256: string }[]>(
        await client.from('attempts').select('id, video_sha256').in('video_sha256', shas),
      )
      for (const row of rows) known.set(row.video_sha256, row.id)
    }
    const fresh = pending.filter(({ index, sha }) => {
      const existing = known.get(sha)
      if (!existing) return true
      results[index] = { clip: clips[index], outcome: 'duplicate', existing_attempt_id: existing, error: duplicate() }
      return false
    })

    // 3. One insert for the rest.
    if (fresh.length > 0) {
      const rows = fresh.map(({ index, sha }) => studyRow(sessionId, clips[index], sha))
      const res = await client.from('attempts').insert(rows).select(ATTEMPT_COLS)
      if (!res.error) {
        const bySha = new Map((res.data as AttemptRow[]).map((a) => [a.video_sha256, a]))
        for (const { index, sha } of fresh) {
          const attempt = bySha.get(sha)
          results[index] = attempt
            ? { clip: clips[index], outcome: 'created', attempt }
            : { clip: clips[index], outcome: 'failed', error: dataError(new Error('row not returned')) }
        }
      } else if ((res.error as Failure).code === '23505') {
        // Another tab imported one of them meanwhile and the whole insert was refused:
        // go clip by clip so only the repeated one is reported.
        for (let i = 0; i < fresh.length; i++) {
          const { index } = fresh[i]
          const one = await client.from('attempts').insert(rows[i]).select(ATTEMPT_COLS).single()
          if (!one.error) results[index] = { clip: clips[index], outcome: 'created', attempt: one.data as AttemptRow }
          else if ((one.error as Failure).code === '23505') {
            results[index] = { clip: clips[index], outcome: 'duplicate', existing_attempt_id: null, error: duplicate() }
          } else {
            results[index] = { clip: clips[index], outcome: 'failed', error: dataError(one.error, SESSION_GONE, one.status) }
          }
        }
      } else {
        throw dataError(res.error, SESSION_GONE, res.status)
      }
    }

    // 4. The same file picked twice points at the row its first copy got.
    for (const { index, of } of repeats) {
      const first = results[of]
      const existing =
        first.outcome === 'created' ? first.attempt.id : first.outcome === 'duplicate' ? first.existing_attempt_id : null
      results[index] = { clip: clips[index], outcome: 'duplicate', existing_attempt_id: existing, error: duplicate() }
    }
    return results
  })
}

/** Attempts of a session in import order (clip name breaks ties inside one batch). */
export function listAttempts(client: SupabaseClient, sessionId: string): Promise<AttemptRow[]> {
  return guard(async () => {
    await requireUid(client)
    return unwrap<AttemptRow[]>(
      await client
        .from('attempts')
        .select(ATTEMPT_COLS)
        .eq('session_id', sessionId)
        .order('created_at', { ascending: true })
        .order('clip_name', { ascending: true }),
    )
  })
}

/**
 * Moves an attempt through queued → processing → done / failed. `error` is a short
 * reason the dancer can read (e.g. "No person was found in this clip") and is kept
 * only with status 'failed'.
 */
export function setAttemptStatus(
  client: SupabaseClient,
  attemptId: string,
  status: AttemptStatus,
  error?: string | null,
): Promise<AttemptRow> {
  return guard(async () => {
    if (!ATTEMPT_STATUSES.includes(status)) throw invalid('invalid_status', 'That status isn’t known.', 'Try again.')
    await requireUid(client)
    const reason = status === 'failed' ? error?.trim().slice(0, 500) || null : null
    // RLS hides rows of other accounts, so "no row came back" is the not-found case.
    const row = unwrap<AttemptRow | null>(
      await client.from('attempts').update({ status, error: reason }).eq('id', attemptId).select(ATTEMPT_COLS).maybeSingle(),
      ATTEMPT_GONE,
    )
    if (!row) throw dataError({ code: 'PGRST116' }, ATTEMPT_GONE)
    return row
  }, ATTEMPT_GONE)
}

/** Saves the dancer's note on an attempt (FR-3.5.7); an empty note clears it. */
export function updateAttemptNote(client: SupabaseClient, attemptId: string, note: string | null): Promise<AttemptRow> {
  return guard(async () => {
    await requireUid(client)
    const row = unwrap<AttemptRow | null>(
      await client.from('attempts').update({ note: normaliseNote(note) }).eq('id', attemptId).select(ATTEMPT_COLS).maybeSingle(),
      ATTEMPT_GONE,
    )
    if (!row) throw dataError({ code: 'PGRST116' }, ATTEMPT_GONE)
    return row
  }, ATTEMPT_GONE)
}

/**
 * Marks or unmarks an attempt as the dancer's reference (FR-3.6.6). Marking one clears
 * the previous reference of the same movement and subject in the database (trigger
 * attempts_single_reference), so callers just refetch afterwards.
 */
export function setReferenceAttempt(client: SupabaseClient, attemptId: string, on: boolean): Promise<AttemptRow> {
  return guard(async () => {
    await requireUid(client)
    const row = unwrap<AttemptRow | null>(
      await client.from('attempts').update({ is_reference: on }).eq('id', attemptId).select(ATTEMPT_COLS).maybeSingle(),
      ATTEMPT_GONE,
    )
    if (!row) throw dataError({ code: 'PGRST116' }, ATTEMPT_GONE)
    return row
  }, ATTEMPT_GONE)
}

/** Deletes an attempt with its keypoints, metrics, notes and any stored clip (FR-3.9.3). */
export function deleteAttempt(client: SupabaseClient, attemptId: string): Promise<void> {
  return guard(async () => {
    const uid = await requireUid(client)
    const attempt = unwrap<Pick<AttemptRow, 'id' | 'video_path'> | null>(
      await client.from('attempts').select('id, video_path').eq('id', attemptId).maybeSingle(),
    )
    if (!attempt) throw dataError({ code: 'PGRST116' }, ATTEMPT_GONE)
    await removeStored(client, uid, [attempt])
    // attempt_keypoints, attempt_metrics and feedback rows go with it (on delete cascade).
    unwrap(await client.from('attempts').delete().eq('id', attemptId).select('id'))
  }, ATTEMPT_GONE)
}

/**
 * Removes the stored files of attempts before their rows go: the cascade only covers
 * tables, and once the row is gone nothing points at the files any more.
 */
async function removeStored(
  client: SupabaseClient,
  uid: string,
  attempts: Pick<AttemptRow, 'id' | 'video_path'>[],
): Promise<void> {
  if (attempts.length === 0) return
  const keypoints = attempts.map((a) => keypointsPath(uid, a.id))
  unwrap(await client.storage.from(KEYPOINTS_BUCKET).remove(keypoints))
  const videos = attempts.map((a) => a.video_path).filter((p): p is string => !!p)
  if (videos.length > 0) unwrap(await client.storage.from(VIDEOS_BUCKET).remove(videos))
}

// ---------- keypoints ----------

const KEYPOINT_COLS = 'attempt_id, owner_id, storage_path, frame_count, size_bytes, model, created_at'

const NO_KEYPOINTS: ErrorCopy = {
  notFound: ['No pose data is saved for this clip yet.', 'Process the clip first.'],
}

/** Object path inside the keypoints bucket; the first folder is what the storage policy checks. */
export function keypointsPath(uid: string, attemptId: string): string {
  return `${uid}/${attemptId}.json.gz`
}

/**
 * Stores the gzipped PoseSeries of an attempt and records where it is. Running it
 * again for the same attempt replaces the file and the row.
 */
export function uploadKeypoints(
  client: SupabaseClient,
  attemptId: string,
  blob: Blob,
  frameCount: number,
  model: string = DEFAULT_POSE_MODEL,
): Promise<AttemptKeypointsRow> {
  return guard(async () => {
    const uid = await requireUid(client)
    // This is the only upload in the data layer, so it refuses anything that isn't a
    // gzip file: a clip or a frame handed over by mistake stops here.
    const head = new Uint8Array(await blob.slice(0, 2).arrayBuffer())
    const gzip = head.length === 2 && head[0] === 0x1f && head[1] === 0x8b
    if (!gzip || /^(video|image)\//.test(blob.type)) {
      throw invalid('not_keypoints', 'The pose data for this clip couldn’t be prepared.', 'Process the clip again.')
    }
    if (!Number.isInteger(frameCount) || frameCount < 0) {
      throw invalid('not_keypoints', 'The pose data for this clip couldn’t be prepared.', 'Process the clip again.')
    }
    if (blob.size > KEYPOINTS_MAX_BYTES) throw dataError({ statusCode: '413' })

    const path = keypointsPath(uid, attemptId)
    unwrap(
      await client.storage
        .from(KEYPOINTS_BUCKET)
        .upload(path, blob, { contentType: 'application/gzip', upsert: true }),
    )
    return unwrap<AttemptKeypointsRow>(
      await client
        .from('attempt_keypoints')
        .upsert(
          { attempt_id: attemptId, storage_path: path, frame_count: frameCount, size_bytes: blob.size, model },
          { onConflict: 'attempt_id' },
        )
        .select(KEYPOINT_COLS)
        .single(),
      ATTEMPT_GONE,
    )
  }, ATTEMPT_GONE)
}

/** The gzipped PoseSeries of an attempt, as stored. */
export function downloadKeypoints(client: SupabaseClient, attemptId: string): Promise<Blob> {
  return guard(async () => {
    await requireUid(client)
    const row = unwrap<Pick<AttemptKeypointsRow, 'storage_path'> | null>(
      await client.from('attempt_keypoints').select('storage_path').eq('attempt_id', attemptId).maybeSingle(),
    )
    if (!row) throw dataError({ code: 'PGRST116' }, NO_KEYPOINTS)
    const blob = unwrap<Blob | null>(await client.storage.from(KEYPOINTS_BUCKET).download(row.storage_path), NO_KEYPOINTS)
    if (!blob) throw dataError({ code: 'PGRST116' }, NO_KEYPOINTS)
    return blob
  }, NO_KEYPOINTS)
}

// ---------- metrics ----------

const METRIC_COLS =
  'attempt_id, owner_id, movement, trunk_inclination_deg, pelvis_ankle_offset_norm, balance_duration_s, ' +
  'knee_tracking_dev_deg, turn_count, feet_angle_deg, phases, confidence, algorithm_version, computed_at, phrase'

/** A value that could not be measured is stored as null, never as zero. */
const measured = (n: number | null | undefined) => (typeof n === 'number' && Number.isFinite(n) ? n : null)

export type MetricsInput = Omit<AttemptMetricsInsert, 'attempt_id' | 'computed_at'>

/** Saves the metrics of an attempt; computing them again replaces the earlier row. */
export function saveMetrics(client: SupabaseClient, attemptId: string, metrics: MetricsInput): Promise<AttemptMetricsRow> {
  return guard(async () => {
    await requireUid(client)
    const row: AttemptMetricsInsert = {
      attempt_id: attemptId,
      movement: metrics.movement,
      trunk_inclination_deg: measured(metrics.trunk_inclination_deg),
      pelvis_ankle_offset_norm: measured(metrics.pelvis_ankle_offset_norm),
      balance_duration_s: measured(metrics.balance_duration_s),
      knee_tracking_dev_deg: measured(metrics.knee_tracking_dev_deg),
      turn_count: measured(metrics.turn_count),
      feet_angle_deg: measured(metrics.feet_angle_deg),
      phases: metrics.phases ?? [],
      confidence: metrics.confidence ?? {},
      algorithm_version: metrics.algorithm_version,
      // The column default only applies to the first insert.
      computed_at: new Date().toISOString(),
      // Phrase attempts only; a re-run as another movement clears it.
      phrase: metrics.phrase ?? null,
    }
    return unwrap<AttemptMetricsRow>(
      await client.from('attempt_metrics').upsert(row, { onConflict: 'attempt_id' }).select(METRIC_COLS).single(),
      ATTEMPT_GONE,
    )
  }, ATTEMPT_GONE)
}

/** Metrics rows for these attempts. Attempts that have none yet are simply absent. */
export function getMetrics(client: SupabaseClient, attemptIds: string[]): Promise<AttemptMetricsRow[]> {
  return guard(async () => {
    await requireUid(client)
    const ids = [...new Set(attemptIds)]
    const out: AttemptMetricsRow[] = []
    for (let i = 0; i < ids.length; i += 100) {
      out.push(
        ...unwrap<AttemptMetricsRow[]>(
          await client.from('attempt_metrics').select(METRIC_COLS).in('attempt_id', ids.slice(i, i + 100)),
        ),
      )
    }
    return out
  })
}
