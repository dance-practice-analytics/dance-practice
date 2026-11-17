// Pure logic of the Import screen (FR-3.2.1–3.2.5): tags read from a file name, the
// check column, the summary counts and the grouping of clips into sessions.
// No DOM and no network here, so all of it is unit-tested.

import { baseName, clipNumberOrNull, parseClipName } from '../../../data/clipFile'
import type { AttemptStatus, CameraView, MovementType } from '../../../data/schema'
import { trimProblem, type TrimRange } from '../../../pose/frames'

export type ImportSource = 'study' | 'own'

/** The designs ask for clips of up to 60 s; longer ones are warned about, not blocked. */
export const MAX_CLIP_SECONDS = 60

export const SUBJECT_CODES: readonly string[] = Array.from({ length: 12 }, (_, i) => `S${String(i + 1).padStart(2, '0')}`)

/** What the screen knows about one picked file. No bytes and no path. */
export interface ClipDraft {
  id: string
  /** File name without any folder part. */
  name: string
  sizeBytes: number
  /** 'reading' until the header, the fingerprint and the thumbnail have been read locally. */
  probe: 'reading' | 'ok' | 'unreadable'
  /** Why the file can't be used, when `probe` is 'unreadable'. */
  problem: string | null
  durationS: number | null
  sha: string | null
  subject: string | null
  movement: MovementType
  view: CameraView
  /** YYYY-MM-DD: the file's modified date on this device, unless the user set the session date. */
  recordedOn: string
  /** Clip number in the dataset (FR-3.2.4), read from the name or typed; null when unknown. */
  clipNumber: number | null
  /** A duplicate of the library the user chose to process again. */
  reprocess: boolean
  /** Set when the server refused the row on an earlier try. */
  failure: string | null
  /** FR-3.2.7: optional start / end of the part to process, seconds of the clip; null = open end. */
  trimStart?: number | null
  trimEnd?: number | null
}

/** A clip this account imported before, found by its SHA-256. */
export interface KnownClip {
  attemptId: string
  importedAt: string
  subjectCode: string | null
  movement: MovementType
  status: AttemptStatus
  /** Its stored trim, reused when it is processed again. */
  trim?: TrimRange | null
}

export type Check =
  | { kind: 'reading' }
  | { kind: 'empty' }
  | { kind: 'unreadable'; message: string }
  | { kind: 'failed'; message: string }
  /** The same file is higher up in this list. */
  | { kind: 'duplicate_in_list'; of: string }
  /** Already in the library: a second row can't be created (unique owner + SHA-256). */
  | { kind: 'duplicate'; known: KnownClip; reprocess: boolean }
  | { kind: 'needs_subject' }
  /** FR-3.2.7: the start / end typed for the trim can't be used. */
  | { kind: 'bad_trim'; message: string }
  | { kind: 'ready'; tooLong: boolean }

// ---------- tags from the file name ----------

const VIEW_WORDS: Record<string, CameraView> = { front: 'front', side: 'side', diag: 'diagonal', diagonal: 'diagonal' }
const SHORT_MOVEMENTS: Record<string, MovementType> = { pir: 'pirouette', rel: 'releve_balance' }
/**
 * The phrase study names its clips `<dancer code>_att<N>_<view letter>`, e.g. `D01_att3_d.mp4`
 * (f front, s side, d diagonal). Only this exact shape reads a single letter as a view, and
 * it is the phrase study's own pattern, so it also tags the movement as a phrase.
 */
const DATASET_CLIP = /^[a-z]\d{2}_att(\d{1,3})_([fsd])$/
const VIEW_LETTERS: Record<string, CameraView> = { f: 'front', s: 'side', d: 'diagonal' }

export interface ParsedTags {
  subject: string | null
  movement: MovementType | null
  view: CameraView | null
  /** Attempt / clip number, e.g. 7 in `S03_releve_front_07.mp4`. */
  clipNumber: number | null
}

const VIDEO_EXT = /\.(mp4|m4v|mov|webm|mkv|avi|3gp|mpg|mpeg|ogv|wmv)$/i

/** A file picked from a folder that is worth listing: a video by type or by extension. */
export function isVideoFile(file: { name: string; type: string; size?: number }): boolean {
  if (/^\./.test(file.name)) return false // hidden files (._clip.mp4 from macOS)
  return file.type.startsWith('video/') || VIDEO_EXT.test(file.name)
}

/**
 * The video files of a picked folder, in name order so clip numbers come out in the
 * dataset's order. Only the bare name is ever read (never `webkitRelativePath`).
 */
export function videoFilesOfFolder<T extends { name: string; type: string }>(files: readonly T[]): { videos: T[]; skipped: number } {
  const videos = files.filter(isVideoFile).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
  return { videos, skipped: files.length - videos.length }
}

/**
 * Subject, movement and camera view from names such as `S05_releve_side_01.mp4` or
 * `S05_pir_front_01.mp4`. A field stays null unless the name states it once.
 */
export function parseTags(name: string): ParsedTags {
  const parsed = parseClipName(name)
  const tokens = baseName(name)
    .replace(/\.[a-z0-9]{2,4}$/i, '')
    .toLowerCase()
    .split(/[\s_\-.,()[\]]+/)
    .filter(Boolean)
  const views = new Set(tokens.map((t) => VIEW_WORDS[t]).filter(Boolean))
  const short = new Set(tokens.map((t) => SHORT_MOVEMENTS[t]).filter(Boolean))
  const dataset = DATASET_CLIP.exec(tokens.join('_'))
  if (dataset) {
    return {
      subject: parsed.subjectCode,
      movement: parsed.movement ?? 'phrase',
      view: VIEW_LETTERS[dataset[2]],
      clipNumber: clipNumberOrNull(Number(dataset[1])),
    }
  }
  return {
    subject: parsed.subjectCode,
    movement: parsed.movement ?? (short.size === 1 ? [...short][0] : null),
    view: views.size === 1 ? [...views][0] : null,
    clipNumber: clipNumberOrNull(parsed.take),
  }
}

/** Local calendar day of a timestamp, as YYYY-MM-DD. */
export function localDate(ms: number): string {
  const d = new Date(Number.isFinite(ms) && ms > 0 ? ms : Date.now())
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** '00:08.2' — the length column. */
export function formatLength(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return '—'
  const tenths = Math.max(0, Math.round(seconds * 10))
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(Math.floor(tenths / 600))}:${pad(Math.floor(tenths / 10) % 60)}.${tenths % 10}`
}

// ---------- the check column ----------

/**
 * One check per row, in list order. Order of the tests matters: a file that can't be
 * read is never reported as a duplicate, and a duplicate never asks for a subject code.
 */
export function checkRows(
  rows: readonly ClipDraft[],
  known: ReadonlyMap<string, KnownClip>,
  source: ImportSource,
): Map<string, Check> {
  const out = new Map<string, Check>()
  const firstBySha = new Map<string, string>()
  for (const row of rows) {
    out.set(row.id, checkOne(row, known, source, firstBySha))
    if (row.sha && row.probe === 'ok' && !firstBySha.has(row.sha)) firstBySha.set(row.sha, row.name)
  }
  return out
}

function checkOne(
  row: ClipDraft,
  known: ReadonlyMap<string, KnownClip>,
  source: ImportSource,
  firstBySha: ReadonlyMap<string, string>,
): Check {
  if (row.sizeBytes === 0) return { kind: 'empty' }
  if (row.probe === 'reading') return { kind: 'reading' }
  if (row.probe === 'unreadable' || !row.sha) {
    return { kind: 'unreadable', message: row.problem ?? 'This file can’t be opened as a video on this device.' }
  }
  if (row.durationS !== null && row.durationS <= 0) return { kind: 'empty' }
  const earlier = firstBySha.get(row.sha)
  if (earlier !== undefined) return { kind: 'duplicate_in_list', of: earlier }
  const hit = known.get(row.sha)
  if (hit) return { kind: 'duplicate', known: hit, reprocess: row.reprocess }
  if (row.failure) return { kind: 'failed', message: row.failure }
  // Study clips are identified by a subject code only; a personal video needs none.
  if (source === 'study' && !row.subject) return { kind: 'needs_subject' }
  const trim = rowTrim(row)
  if (trim.problem) return { kind: 'bad_trim', message: trim.problem }
  return { kind: 'ready', tooLong: row.durationS !== null && row.durationS > MAX_CLIP_SECONDS }
}

export interface ImportCounts {
  /** New rows that will be created. */
  ready: number
  /** Library duplicates the user chose to process again. */
  reprocess: number
  /** Duplicates that are skipped (library or same file twice in the list). */
  duplicates: number
  needsSubject: number
  /** Rows whose trim needs fixing. */
  badTrim: number
  /** Empty, unreadable or refused by the server. */
  unusable: number
  reading: number
  /** ready + reprocess: what the main button adds to the queue. */
  toQueue: number
}

export function countChecks(checks: Iterable<Check>): ImportCounts {
  const c: ImportCounts = { ready: 0, reprocess: 0, duplicates: 0, needsSubject: 0, badTrim: 0, unusable: 0, reading: 0, toQueue: 0 }
  for (const check of checks) {
    if (check.kind === 'ready') c.ready++
    else if (check.kind === 'duplicate') check.reprocess ? c.reprocess++ : c.duplicates++
    else if (check.kind === 'duplicate_in_list') c.duplicates++
    else if (check.kind === 'needs_subject') c.needsSubject++
    else if (check.kind === 'bad_trim') c.badTrim++
    else if (check.kind === 'reading') c.reading++
    else c.unusable++
  }
  c.toQueue = c.ready + c.reprocess
  return c
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** The muted part of the summary bar, e.g. '1 already imported · 1 needs a subject code'. */
export function summaryDetail(c: ImportCounts): string {
  const parts: string[] = []
  if (c.reprocess) parts.push(`${c.reprocess} to process again`)
  if (c.duplicates) parts.push(`${c.duplicates} already imported`)
  if (c.needsSubject) parts.push(c.needsSubject === 1 ? '1 needs a subject code' : `${c.needsSubject} need a subject code`)
  if (c.badTrim) parts.push(`${plural(c.badTrim, 'trim', 'trims')} to fix`)
  if (c.unusable) parts.push(`${plural(c.unusable, 'file', 'files')} can’t be used`)
  if (c.reading) parts.push(`reading ${plural(c.reading, 'file', 'files')}…`)
  return parts.join(' · ')
}

// ---------- trim (FR-3.2.7) ----------

/**
 * The trim of a row: `range` is null for the whole clip (nothing typed, or start 0 and
 * end at the clip's length). An open end means the start / the end of the clip.
 */
export function rowTrim(row: Pick<ClipDraft, 'trimStart' | 'trimEnd' | 'durationS'>): { range: TrimRange | null; problem: string | null } {
  const start = row.trimStart ?? null
  const end = row.trimEnd ?? null
  if (start === null && end === null) return { range: null, problem: null }
  const duration = row.durationS
  if (duration === null || !Number.isFinite(duration) || duration <= 0) {
    return { range: null, problem: 'The clip’s length isn’t known yet, so it can’t be trimmed.' }
  }
  const range = { startS: start ?? 0, endS: end ?? duration }
  const problem = trimProblem(range, duration)
  if (problem) return { range: null, problem }
  if (range.startS <= 0 && range.endS >= duration) return { range: null, problem: null }
  return { range, problem: null }
}

/** '00:01.5–00:06.0 of 00:08.2' for a trimmed row; null for the whole clip. */
export function trimSummary(row: Pick<ClipDraft, 'trimStart' | 'trimEnd' | 'durationS'>): string | null {
  const { range } = rowTrim(row)
  if (!range) return null
  return `${formatLength(range.startS)}–${formatLength(range.endS)} of ${formatLength(row.durationS)}`
}

// ---------- sessions ----------

export interface SessionGroup {
  key: string
  subject: string | null
  movement: MovementType
  view: CameraView
  recordedOn: string
  rows: ClipDraft[]
}

/**
 * The session rule: clips with the same subject code, movement, camera view and
 * recording date (the file's date on this device) form one session, and each clip is
 * one attempt in it. Groups keep the order in which their first clip was listed.
 */
export function groupIntoSessions(rows: readonly ClipDraft[]): SessionGroup[] {
  const groups = new Map<string, SessionGroup>()
  for (const row of rows) {
    const key = [row.subject ?? '', row.movement, row.view, row.recordedOn].join('|')
    const group = groups.get(key)
    if (group) group.rows.push(row)
    else {
      groups.set(key, { key, subject: row.subject, movement: row.movement, view: row.view, recordedOn: row.recordedOn, rows: [row] })
    }
  }
  return [...groups.values()]
}

export interface SessionLike {
  id: string
  subject_code: string | null
  movement_type: MovementType
  camera_view: CameraView | null
  recorded_on: string | null
}

/** An existing session a group belongs to (same four fields), so a second batch joins it. */
export function findSession<S extends SessionLike>(sessions: readonly S[], group: SessionGroup): S | null {
  return (
    sessions.find(
      (s) =>
        (s.subject_code ?? null) === group.subject &&
        s.movement_type === group.movement &&
        s.camera_view === group.view &&
        s.recorded_on === group.recordedOn,
    ) ?? null
  )
}
