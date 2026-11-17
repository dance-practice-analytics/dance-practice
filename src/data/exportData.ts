// Export of the signed-in account's own data (FR-3.9.1, FR-3.9.2, FR-3.9.5).
// Everything is read through the publishable key, so RLS decides what comes back;
// every query also filters by the caller's uid. The functions return a document, a
// string or Blobs and never save anything: the screen decides how to offer them.
//
// What an export can contain is fixed here, field by field. It never has a clip, a
// frame, a storage path, a file hash, an email, a display name or a user id, and
// subjects appear by code only. Text a person typed (session title and note, attempt
// label and note) and the de-identified clip label are left out unless the caller asks
// for them with `includeLabels`. A clip's original file name is never exported (FR-3.2.5).
// A value that is not available is null (JSON) or an empty cell (CSV) next to the
// reason, never zero.

import type { SupabaseClient } from '@supabase/supabase-js'
import { ApiError } from '../api/errors'
import { clipNumberOrNull, safeStoredClipName } from './clipFile'
import { dataError, keypointsPath } from './repo'
import {
  KEYPOINTS_BUCKET,
  SUBJECT_CODE_RE,
  type AttemptKeypointsRow,
  type AttemptMetricsRow,
  type AttemptRow,
  type AttemptSource,
  type AttemptStatus,
  type CameraView,
  type ConfidenceLevel,
  type ConsentRow,
  type FeedbackRow,
  type MovementType,
  type PhaseSpan,
  type SessionRow,
  type SubjectRow,
} from './schema'

// ---------- shared with deleteData.ts ----------

/** The signed-in user id, read from the local session (no network). */
export async function requireUid(client: SupabaseClient): Promise<string> {
  let uid: string | undefined
  try {
    const { data, error } = await client.auth.getSession()
    if (!error) uid = data?.session?.user?.id
  } catch {
    uid = undefined
  }
  if (!uid) throw new ApiError(401, 'not_signed_in', 'You’re not signed in.', 'Sign in and try again.')
  return uid
}

/** Maps anything thrown; the generic "didn't save" copy is replaced by the caller's. */
export async function guardAs<T>(fallback: [code: string, message: string, recovery: string], fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (e) {
    const mapped = dataError(e)
    throw mapped.code === 'data_error' ? new ApiError(mapped.status, ...fallback) : mapped
  }
}

interface Result {
  data: unknown
  error: unknown
  status?: number
  count?: number | null
}

/** PostgREST answers at most 1000 rows per request by default. */
const PAGE = 1000

/**
 * Every row of `table` that belongs to `uid`, in a stable order, page by page.
 * `where` narrows it with one more equality (a session's attempts, say).
 */
export async function selectOwn<T>(
  client: SupabaseClient,
  table: string,
  cols: string,
  uid: string,
  order: string[],
  where?: [col: string, value: string],
): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += PAGE) {
    let q = client.from(table).select(cols).eq('owner_id', uid)
    if (where) q = q.eq(where[0], where[1])
    for (const col of order) q = q.order(col, { ascending: true })
    const res = (await q.range(from, from + PAGE - 1)) as Result
    if (res.error) throw dataError(res.error, undefined, res.status)
    const rows = (res.data ?? []) as T[]
    out.push(...rows)
    if (rows.length < PAGE) return out
  }
}

// ---------- the document ----------

export const EXPORT_FORMAT = 'dance-practice-analytics.export'
/** Raised when a field is renamed or removed; adding a field keeps the version. */
export const EXPORT_VERSION = 1

/** Metric ids are the value columns of attempt_metrics, in export order. */
export const EXPORT_METRICS = [
  { metric: 'trunk_inclination_deg', unit: 'deg' },
  { metric: 'pelvis_ankle_offset_norm', unit: 'ratio_of_leg_length' },
  { metric: 'balance_duration_s', unit: 's' },
  { metric: 'knee_tracking_dev_deg', unit: 'deg' },
  { metric: 'turn_count', unit: 'turns' },
] as const
export type ExportMetricKey = (typeof EXPORT_METRICS)[number]['metric']

/**
 * Why a value is null. The engine's own reason (confidence[metric].reason, e.g.
 * 'no_lift_detected') is passed through; the others are set here:
 * 'not_processed' / 'processing' / 'processing_failed' when the attempt has no
 * metrics row, 'not_applicable' for a turn count on a relevé balance, and
 * 'not_measured' when the row has no reason for it.
 */
export type ExportNullReason = string

export interface ExportMetric {
  metric: ExportMetricKey
  unit: string
  value: number | null
  /** Set exactly when value is null. */
  null_reason: ExportNullReason | null
  confidence_level: ConfidenceLevel | null
  /** 0..1 */
  confidence_score: number | null
  /** Qualifiers the engine attached to a computed value. */
  qualifiers: string[]
}

export interface ExportKeypoints {
  frame_count: number
  size_bytes: number | null
  model: string
  created_at: string
  /** Path of the file in `ExportBundle.keypoints`; null when files were not asked for or not available. */
  file: string | null
  file_null_reason: 'not_included' | 'not_available' | null
}

export interface ExportFeedback {
  id: string
  model: string
  prompt_version: string
  created_at: string
  /** The stored practice notes (FeedbackResponse), written from metrics only. */
  response: unknown
}

export interface ExportAttempt {
  id: string
  source: AttemptSource
  status: AttemptStatus
  /** Short app-written reason, only for a failed attempt. */
  status_reason: string | null
  duration_s: number | null
  fps: number | null
  created_at: string
  /** Only with `includeLabels`. */
  label?: string | null
  /** Only with `includeLabels`. De-identified clip label (`S03_att07.mp4`), never a file name. */
  clip_name?: string | null
  /** Only with `includeLabels`. The account's own note on the attempt. */
  note?: string | null
  /** Clip number within the subject's dataset; null when unknown. */
  clip_number: number | null
  /** null when metrics were not computed. */
  metrics_run: { movement: MovementType; algorithm_version: string; computed_at: string } | null
  phases: PhaseSpan[] | null
  /** Always one entry per metric, in the order of EXPORT_METRICS. */
  metrics: ExportMetric[]
  keypoints: ExportKeypoints | null
  feedback: ExportFeedback[]
}

export interface ExportSession {
  id: string
  subject_code: string | null
  movement_type: MovementType
  recorded_on: string | null
  camera_view: CameraView | null
  created_at: string
  /** Only with `includeLabels`. */
  title?: string | null
  /** Only with `includeLabels`. The account's own note on the session. */
  note?: string | null
  attempts: ExportAttempt[]
}

export interface ExportConsent {
  scope: string
  /** null for the account's own consent; a code for a study subject's form. */
  subject_code: string | null
  form_reference: string | null
  granted_on: string
  revoked_on: string | null
  created_at: string
}

export interface ExportDocument {
  format: typeof EXPORT_FORMAT
  version: typeof EXPORT_VERSION
  /** ISO 8601, UTC. */
  generated_at: string
  about: string
  includes: { labels: boolean; keypoint_files: boolean }
  counts: { sessions: number; attempts: number; attempts_with_metrics: number; feedback: number; consents: number }
  sessions: ExportSession[]
  consents: ExportConsent[]
}

export interface ExportFile {
  /** Relative name for saving, e.g. keypoints/{attempt_id}.json.gz. No user id in it. */
  path: string
  /** gzip of the PoseSeries JSON, as stored: landmark coordinates only, no image. */
  blob: Blob
}

export interface ExportBundle {
  document: ExportDocument
  /** `document` as indented JSON text (UTF-8 when saved). */
  json: string
  /** Empty unless `includeKeypoints` was set. */
  keypoints: ExportFile[]
  /** Keypoint files that were asked for and could not be read; the rest of the export is still complete. */
  keypointsUnavailable: { attempt_id: string; code: string; message: string }[]
}

export interface ExportOptions {
  /** Also download each attempt's gzipped keypoints (FR-3.9.5). Default false. */
  includeKeypoints?: boolean
  /** Also include text the account typed: session title and note, attempt label and note, clip label. Default false. */
  includeLabels?: boolean
  /** Clock for `generated_at` (tests). */
  now?: Date
}

const ABOUT =
  'Measurements of this account’s own attempts. null means the value is not available; null_reason says why. ' +
  'No video, frames, names or email addresses are part of this file. Subjects appear by code only.'

// ---------- reading ----------

/** The rows an export is built from. Only the listed columns are ever requested. */
export interface ExportRows {
  subjects: Pick<SubjectRow, 'id' | 'subject_code'>[]
  sessions: (Omit<SessionRow, 'owner_id' | 'note'> & Partial<Pick<SessionRow, 'note'>>)[]
  attempts: (Pick<
    AttemptRow,
    'id' | 'session_id' | 'source' | 'label' | 'clip_name' | 'duration_s' | 'fps' | 'status' | 'error' | 'created_at'
  > &
    Partial<Pick<AttemptRow, 'clip_number' | 'note'>>)[]
  keypoints: Pick<AttemptKeypointsRow, 'attempt_id' | 'frame_count' | 'size_bytes' | 'model' | 'created_at'>[]
  metrics: Omit<AttemptMetricsRow, 'owner_id'>[]
  feedback: Pick<FeedbackRow, 'id' | 'attempt_id' | 'model' | 'prompt_version' | 'response' | 'created_at'>[]
  consents: Pick<ConsentRow, 'subject_id' | 'scope' | 'form_reference' | 'granted_on' | 'revoked_on' | 'created_at'>[]
}

// No owner_id, video_path, video_sha256, storage_path, input_hash or subject notes,
// and the profiles table (display name) is not read at all.
const COLS = {
  subjects: 'id, subject_code',
  sessions: 'id, subject_id, movement_type, title, recorded_on, camera_view, note, created_at',
  attempts: 'id, session_id, source, label, clip_name, clip_number, note, duration_s, fps, status, error, created_at',
  attempt_keypoints: 'attempt_id, frame_count, size_bytes, model, created_at',
  attempt_metrics:
    'attempt_id, movement, trunk_inclination_deg, pelvis_ankle_offset_norm, balance_duration_s, ' +
    'knee_tracking_dev_deg, turn_count, phases, confidence, algorithm_version, computed_at',
  feedback: 'id, attempt_id, model, prompt_version, response, created_at',
  consents: 'id, subject_id, scope, form_reference, granted_on, revoked_on, created_at',
} as const

async function readRows(client: SupabaseClient, uid: string): Promise<ExportRows> {
  const [subjects, sessions, attempts, keypoints, metrics, feedback, consents] = await Promise.all([
    selectOwn<ExportRows['subjects'][number]>(client, 'subjects', COLS.subjects, uid, ['subject_code']),
    selectOwn<ExportRows['sessions'][number]>(client, 'sessions', COLS.sessions, uid, ['created_at', 'id']),
    selectOwn<ExportRows['attempts'][number]>(client, 'attempts', COLS.attempts, uid, ['created_at', 'id']),
    selectOwn<ExportRows['keypoints'][number]>(client, 'attempt_keypoints', COLS.attempt_keypoints, uid, ['attempt_id']),
    selectOwn<ExportRows['metrics'][number]>(client, 'attempt_metrics', COLS.attempt_metrics, uid, ['attempt_id']),
    selectOwn<ExportRows['feedback'][number]>(client, 'feedback', COLS.feedback, uid, ['created_at', 'id']),
    selectOwn<ExportRows['consents'][number]>(client, 'consents', COLS.consents, uid, ['created_at', 'id']),
  ])
  return { subjects, sessions, attempts, keypoints, metrics, feedback, consents }
}

// ---------- building (pure) ----------

const finite = (n: unknown): number | null => (typeof n === 'number' && Number.isFinite(n) ? n : null)
const LEVELS: readonly string[] = ['high', 'medium', 'low']
const clipNumberOf = (n: unknown) => clipNumberOrNull(n)

function noMetricsReason(status: AttemptStatus): ExportNullReason {
  if (status === 'failed') return 'processing_failed'
  if (status === 'processing') return 'processing'
  return 'not_processed'
}

function metricValues(attempt: ExportRows['attempts'][number], row: ExportRows['metrics'][number] | undefined): ExportMetric[] {
  return EXPORT_METRICS.map(({ metric, unit }) => {
    if (!row) {
      return {
        metric,
        unit,
        value: null,
        null_reason: noMetricsReason(attempt.status),
        confidence_level: null,
        confidence_score: null,
        qualifiers: [],
      }
    }
    const value = finite(row[metric])
    const conf = (row.confidence?.[metric] ?? {}) as { level?: unknown; score?: unknown; reason?: unknown; notes?: unknown }
    let reason: ExportNullReason | null = null
    if (value === null) {
      if (typeof conf.reason === 'string' && conf.reason) reason = conf.reason
      else if (metric === 'turn_count' && row.movement !== 'pirouette') reason = 'not_applicable'
      else reason = 'not_measured'
    }
    return {
      metric,
      unit,
      value,
      null_reason: reason,
      confidence_level: LEVELS.includes(conf.level as string) ? (conf.level as ConfidenceLevel) : null,
      confidence_score: finite(conf.score),
      qualifiers: Array.isArray(conf.notes) ? conf.notes.filter((n): n is string => typeof n === 'string') : [],
    }
  })
}

/**
 * Rows → export document. `keypointFiles` maps an attempt id to the path of its
 * file in the bundle (absent when the file was not read); pass null when keypoint
 * files were not asked for.
 */
export function buildExportDocument(
  rows: ExportRows,
  options: { includeLabels?: boolean; now?: Date; keypointFiles?: Map<string, string> | null } = {},
): ExportDocument {
  const labels = options.includeLabels === true
  const files = options.keypointFiles ?? null
  const codeOf = new Map(rows.subjects.map((s) => [s.id, SUBJECT_CODE_RE.test(s.subject_code) ? s.subject_code : null]))
  const subjectCode = (id: string | null) => (id == null ? null : (codeOf.get(id) ?? null))
  const metricsOf = new Map(rows.metrics.map((m) => [m.attempt_id, m]))
  const keypointsOf = new Map(rows.keypoints.map((k) => [k.attempt_id, k]))
  const feedbackOf = new Map<string, ExportFeedback[]>()
  for (const f of rows.feedback) {
    const list = feedbackOf.get(f.attempt_id) ?? []
    list.push({ id: f.id, model: f.model, prompt_version: f.prompt_version, created_at: f.created_at, response: f.response ?? null })
    feedbackOf.set(f.attempt_id, list)
  }

  const attemptsOf = new Map<string, ExportAttempt[]>()
  for (const a of rows.attempts) {
    const m = metricsOf.get(a.id)
    const k = keypointsOf.get(a.id)
    const file = files?.get(a.id) ?? null
    const attempt: ExportAttempt = {
      id: a.id,
      source: a.source,
      status: a.status,
      status_reason: a.status === 'failed' ? (a.error ?? null) : null,
      duration_s: finite(a.duration_s),
      fps: finite(a.fps),
      created_at: a.created_at,
      clip_number: clipNumberOf(a.clip_number),
      // A row saved before names were de-identified is rebuilt here, so no file name leaves.
      ...(labels
        ? { label: a.label ?? null, clip_name: safeStoredClipName(a.clip_name, clipNumberOf(a.clip_number)), note: a.note ?? null }
        : {}),
      metrics_run: m ? { movement: m.movement, algorithm_version: m.algorithm_version, computed_at: m.computed_at } : null,
      phases: m ? (Array.isArray(m.phases) ? m.phases.map(({ phase, start, end }) => ({ phase, start, end })) : []) : null,
      metrics: metricValues(a, m),
      keypoints: k
        ? {
            frame_count: k.frame_count,
            size_bytes: k.size_bytes ?? null,
            model: k.model,
            created_at: k.created_at,
            file,
            file_null_reason: file ? null : files ? 'not_available' : 'not_included',
          }
        : null,
      feedback: feedbackOf.get(a.id) ?? [],
    }
    const list = attemptsOf.get(a.session_id) ?? []
    list.push(attempt)
    attemptsOf.set(a.session_id, list)
  }

  const sessions: ExportSession[] = rows.sessions.map((s) => ({
    id: s.id,
    subject_code: subjectCode(s.subject_id),
    movement_type: s.movement_type,
    recorded_on: s.recorded_on ?? null,
    camera_view: s.camera_view ?? null,
    created_at: s.created_at,
    ...(labels ? { title: s.title ?? null, note: s.note ?? null } : {}),
    attempts: attemptsOf.get(s.id) ?? [],
  }))
  const exported = sessions.flatMap((s) => s.attempts)

  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    generated_at: (options.now ?? new Date()).toISOString(),
    about: ABOUT,
    includes: { labels, keypoint_files: files !== null },
    counts: {
      sessions: sessions.length,
      attempts: exported.length,
      attempts_with_metrics: exported.filter((a) => a.metrics_run !== null).length,
      feedback: exported.reduce((n, a) => n + a.feedback.length, 0),
      consents: rows.consents.length,
    },
    sessions,
    consents: rows.consents.map((c) => ({
      scope: c.scope,
      subject_code: subjectCode(c.subject_id),
      form_reference: c.form_reference ?? null,
      granted_on: c.granted_on,
      revoked_on: c.revoked_on ?? null,
      created_at: c.created_at,
    })),
  }
}

// ---------- CSV ----------

/** Column order of the metrics CSV. Fixed: new columns are only ever added at the end. */
export const METRICS_CSV_COLUMNS = [
  'session_id',
  'subject_code',
  'movement',
  'recorded_on',
  'camera_view',
  'attempt_id',
  'attempt_source',
  'attempt_status',
  'attempt_created_at',
  'metric',
  'unit',
  'value',
  'null_reason',
  'confidence_level',
  'confidence_score',
  'algorithm_version',
  'computed_at',
] as const

/**
 * One CSV cell (RFC 4180). null and undefined are an empty cell; a number is written
 * as is; text is quoted when it has a comma, a quote, a line break or outer spaces.
 * Text that a spreadsheet would run as a formula gets a leading apostrophe.
 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : ''
  let text = String(value)
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`
  return /[",\r\n]|^\s|\s$/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/**
 * The metrics CSV (FR-3.9.1, FR-3.9.2): a header, then one row per attempt × metric,
 * also for attempts without metrics. A value that is not available is an empty cell
 * with `null_reason` filled in. CRLF line ends, no byte order mark; save it as
 * `text/csv;charset=utf-8`.
 */
export function metricsCsv(document: ExportDocument): string {
  const lines: string[] = [METRICS_CSV_COLUMNS.join(',')]
  for (const s of document.sessions) {
    for (const a of s.attempts) {
      for (const m of a.metrics) {
        const row: Record<(typeof METRICS_CSV_COLUMNS)[number], unknown> = {
          session_id: s.id,
          subject_code: s.subject_code,
          movement: a.metrics_run?.movement ?? s.movement_type,
          recorded_on: s.recorded_on,
          camera_view: s.camera_view,
          attempt_id: a.id,
          attempt_source: a.source,
          attempt_status: a.status,
          attempt_created_at: a.created_at,
          metric: m.metric,
          unit: m.unit,
          value: m.value,
          null_reason: m.null_reason,
          confidence_level: m.confidence_level,
          confidence_score: m.confidence_score,
          algorithm_version: a.metrics_run?.algorithm_version ?? null,
          computed_at: a.metrics_run?.computed_at ?? null,
        }
        lines.push(METRICS_CSV_COLUMNS.map((c) => csvCell(row[c])).join(','))
      }
    }
  }
  return lines.join('\r\n') + '\r\n'
}

// ---------- public API ----------

const EXPORT_FAILED: [string, string, string] = ['export_failed', 'The export couldn’t be prepared.', 'Try again in a moment.']

/** Name of an attempt's keypoints file inside an export. */
export function exportKeypointsPath(attemptId: string): string {
  return `keypoints/${attemptId}.json.gz`
}

/**
 * Everything the signed-in account has stored, as one versioned JSON document:
 * sessions → attempts → metrics with confidence and phases, practice notes, consents.
 * With `includeKeypoints`, each attempt's gzipped keypoints come back as separate
 * Blobs; one that can't be read is listed in `keypointsUnavailable` and the export
 * still completes.
 */
export function exportAll(client: SupabaseClient, options: ExportOptions = {}): Promise<ExportBundle> {
  return guardAs(EXPORT_FAILED, async () => {
    const uid = await requireUid(client)
    const rows = await readRows(client, uid)

    const keypoints: ExportFile[] = []
    const keypointsUnavailable: ExportBundle['keypointsUnavailable'] = []
    let files: Map<string, string> | null = null
    if (options.includeKeypoints) {
      files = new Map()
      const ids = rows.keypoints.map((k) => k.attempt_id)
      // A few at a time: the study set alone is 180 files.
      for (let i = 0; i < ids.length; i += 4) {
        const batch = ids.slice(i, i + 4)
        const results = await Promise.all(batch.map((id) => readKeypoints(client, uid, id)))
        results.forEach((r, n) => {
          const id = batch[n]
          if (r instanceof ApiError) keypointsUnavailable.push({ attempt_id: id, code: r.code, message: r.message })
          else {
            const path = exportKeypointsPath(id)
            keypoints.push({ path, blob: r })
            files!.set(id, path)
          }
        })
      }
    }

    const document = buildExportDocument(rows, { includeLabels: options.includeLabels, now: options.now, keypointFiles: files })
    return { document, json: JSON.stringify(document, null, 2), keypoints, keypointsUnavailable }
  })
}

/** The metrics CSV of the signed-in account's attempts. See `metricsCsv` for the format. */
export function exportMetricsCsv(client: SupabaseClient): Promise<string> {
  return guardAs(EXPORT_FAILED, async () => {
    const uid = await requireUid(client)
    return metricsCsv(buildExportDocument(await readRows(client, uid)))
  })
}

/** The stored file is always read from the caller's own folder, whatever the row says. */
async function readKeypoints(client: SupabaseClient, uid: string, attemptId: string): Promise<Blob | ApiError> {
  const missing: [string, string] = ['The pose data for this clip couldn’t be read.', 'Process the clip again, then export.']
  try {
    const res = await client.storage.from(KEYPOINTS_BUCKET).download(keypointsPath(uid, attemptId))
    if (res.error) return dataError(res.error, { notFound: missing })
    if (!res.data) return dataError({ code: 'PGRST116' }, { notFound: missing })
    // Only a gzip file is passed on, and never as a media type.
    const head = new Uint8Array(await res.data.slice(0, 2).arrayBuffer())
    if (head[0] !== 0x1f || head[1] !== 0x8b || /^(video|image)\//.test(res.data.type)) {
      return new ApiError(422, 'not_keypoints', ...missing)
    }
    return res.data
  } catch (e) {
    return dataError(e, { notFound: missing })
  }
}
