// View-model of the Library (and of the cards the Dashboard shares with it): pure
// functions from the loaded rows to what the screen prints. No React, no fetching.
// Every derived number and sentence comes from src/insights; nothing here grades.

import type { SessionSummary } from '../../../data/repo'
import type { AttemptMetricsRow, CameraView, DateOnly, MovementType } from '../../../data/schema'
import type { FeedbackNote } from '../../../feedback/client'
import { NEEDS_TWO_SESSIONS_TEXT, exclusionText, gapText, progressSeries, sessionDay } from '../../../insights'
import type { ProgressPoint, ProgressSeries } from '../../../insights'
import type { AttemptView } from '../../data'
import { phraseOf, readTheme, THEME_KEYS } from '../phrase/model'
import {
  CONFIDENCE_LABELS,
  METRICS,
  MOVEMENT_LABELS,
  NULL_REASON_TEXT,
  PHASE_LABELS,
  VIEW_LABELS,
  formatDate,
  formatMetricWithUnit,
  readMetric,
  readMetrics,
  type MetricKey,
  type NullReason,
  type Phase,
} from '../../format'

// ---------- small helpers ----------

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

/** ISO days inside an insights sentence, as the short dates the screens use. */
export function prettyDates(text: string, now: Date = new Date()): string {
  return text.replace(/\d{4}-\d{2}-\d{2}/g, (d) => formatDate(d, now))
}

/** 'side view' for a line of meta text; null view → 'view not recorded'. */
export function viewText(view: CameraView | null): string {
  return view ? VIEW_LABELS[view].toLowerCase() : 'view not recorded'
}

// ---------- one attempt ----------

/**
 * What a tile says. 'low' = processed, some value has low camera visibility; 'none' =
 * processed, but no metric has a value. Both are shown hatched, never hidden.
 */
export type TileKind = 'done' | 'low' | 'none' | 'processing' | 'queued' | 'failed'

/** Status of the attempts that are in this tab's processing queue right now. */
export type LiveStatus = ReadonlyMap<string, 'queued' | 'processing'>

export function tileKind(attempt: AttemptView, live?: LiveStatus): TileKind {
  const now = live?.get(attempt.id)
  if (now) return now
  if (attempt.status === 'failed') return 'failed'
  // 'processing' in the database without a queue item is a closed tab's leftover.
  if (attempt.status !== 'done') return 'queued'
  // A phrase has no relevé measures (stored as null, not applicable): its themes say it.
  const readings =
    attempt.session.movement_type === 'phrase'
      ? THEME_KEYS.map((k) => readTheme(phraseOf(attempt.metrics), k))
      : readMetrics(attempt.metrics, attempt.session.movement_type)
  if (readings.every((r) => r.value === null)) return 'none'
  return readings.some((r) => r.confidence === 'low') ? 'low' : 'done'
}

export const TILE_LABEL: Record<TileKind, string> = {
  done: 'Done',
  low: CONFIDENCE_LABELS.low,
  none: 'Not seen',
  processing: 'Processing',
  queued: 'Queued',
  failed: 'Failed',
}

export type TileStatus = 'done' | 'processing' | 'queued' | 'failed'

/** The processing status behind a tile (low / none are finished clips). */
export function tileStatus(kind: TileKind): TileStatus {
  return kind === 'low' || kind === 'none' ? 'done' : kind
}

export const needsAttention = (kind: TileKind) => kind === 'failed' || kind === 'low' || kind === 'none'

// ---------- filters ----------

export type StatusFilter = 'all' | TileStatus

/** Key of the group of sessions without a subject (personal videos). */
export const PERSONAL = 'personal'
export const PERSONAL_LABEL = 'Personal videos'

export interface Filters {
  q: string
  /** 'all', a subject code, or PERSONAL. */
  subject: string
  movement: MovementType | 'all'
  view: CameraView | 'any'
  status: StatusFilter
  /** Phone chip: failed, low confidence or no tracking only. */
  attention: boolean
}

export const NO_FILTERS: Filters = { q: '', subject: 'all', movement: 'all', view: 'any', status: 'all', attention: false }

export function hasFilters(f: Filters): boolean {
  return f.q.trim() !== '' || f.subject !== 'all' || f.movement !== 'all' || f.view !== 'any' || f.status !== 'all' || f.attention
}

export const subjectKey = (s: { subject_code: string | null }) => s.subject_code ?? PERSONAL

function matches(a: AttemptView, kind: TileKind, f: Filters, withStatus: boolean): boolean {
  const s = a.session
  if (f.subject !== 'all' && subjectKey(s) !== f.subject) return false
  if (f.movement !== 'all' && s.movement_type !== f.movement) return false
  if (f.view !== 'any' && s.camera_view !== f.view) return false
  if (f.attention && !needsAttention(kind)) return false
  if (withStatus && f.status !== 'all' && tileStatus(kind) !== f.status) return false
  const q = f.q.trim().toLowerCase()
  if (!q) return true
  return [a.clip_name, a.label, s.subject_code, s.title].some((t) => t?.toLowerCase().includes(q))
}

/** What the filters say, for the "no clips match" state: 'S09 · Pirouette · Diagonal view'. */
export function describeFilters(f: Filters): string {
  const parts: string[] = []
  if (f.q.trim()) parts.push(`“${f.q.trim()}”`)
  if (f.subject !== 'all') parts.push(f.subject === PERSONAL ? PERSONAL_LABEL : f.subject)
  if (f.movement !== 'all') parts.push(MOVEMENT_LABELS[f.movement])
  if (f.view !== 'any') parts.push(VIEW_LABELS[f.view])
  if (f.status !== 'all') parts.push(TILE_LABEL[f.status])
  if (f.attention) parts.push('Needs attention')
  return parts.join(' · ')
}

// ---------- sessions ----------

/**
 * "Session 3": the position of a session among the sessions of the same subject and
 * movement, oldest first.
 */
export function sessionNumbers(sessions: readonly SessionSummary[], attempts: readonly AttemptView[]): Map<string, number> {
  const own = new Map<string, AttemptView[]>()
  for (const a of attempts) {
    const list = own.get(a.session_id)
    if (list) list.push(a)
    else own.set(a.session_id, [a])
  }
  const families = new Map<string, { s: SessionSummary; day: string }[]>()
  for (const s of sessions) {
    const key = `${subjectKey(s)}|${s.movement_type}`
    const entry = { s, day: sessionDay(s, own.get(s.id) ?? []) ?? '' }
    const list = families.get(key)
    if (list) list.push(entry)
    else families.set(key, [entry])
  }
  const out = new Map<string, number>()
  for (const list of families.values()) {
    list.sort((a, b) => a.day.localeCompare(b.day) || a.s.created_at.localeCompare(b.s.created_at) || a.s.id.localeCompare(b.s.id))
    list.forEach((e, i) => out.set(e.s.id, i + 1))
  }
  return out
}

export interface Tile {
  attempt: AttemptView
  kind: TileKind
}

export interface SessionBlock {
  session: SessionSummary
  number: number
  /** 'Relevé balance · Session 3' */
  title: string
  /** 'Nov 11 · side view · 5 attempts' */
  meta: string
  date: DateOnly | null
  /** The attempts that pass the filters, in import order. */
  tiles: Tile[]
  /** Attempts of the session before filtering. */
  total: number
}

export interface GroupStatus {
  status: TileStatus
  text: string
}

export interface SubjectGroup {
  /** Subject code, or PERSONAL. */
  key: string
  code: string | null
  /** '15 clips · 3 sessions' */
  summary: string
  status: GroupStatus
  /** Newest first. */
  sessions: SessionBlock[]
  /** Something is queued, processing or failed. */
  active: boolean
}

export function countKinds(tiles: readonly Tile[]): Record<TileKind, number> {
  const n: Record<TileKind, number> = { done: 0, low: 0, none: 0, processing: 0, queued: 0, failed: 0 }
  for (const t of tiles) n[t.kind]++
  return n
}

/** One status line for a set of clips: what is unfinished first, then what is done. */
export function groupStatus(tiles: readonly Tile[]): GroupStatus {
  const n = countKinds(tiles)
  if (n.failed > 0) return { status: 'failed', text: `${n.failed} failed` }
  if (n.processing > 0) {
    return { status: 'processing', text: [`${n.processing} processing`, n.queued ? `${n.queued} queued` : ''].filter(Boolean).join(' · ') }
  }
  if (n.queued > 0) return { status: 'queued', text: `${n.queued} queued` }
  const done = n.done + n.low + n.none
  const extra = [n.low ? `${n.low} low camera visibility` : '', n.none ? `${n.none} no tracking` : ''].filter(Boolean)
  return { status: 'done', text: [`${done} done`, ...extra].join(' · ') }
}

export interface LibraryModel {
  groups: SubjectGroup[]
  /** Clips per status under the other filters (the numbers on the status chips). */
  counts: Record<StatusFilter, number>
  /** Clips shown. */
  shown: number
  /** Subject keys that exist in the account, codes first, PERSONAL last. */
  subjects: string[]
  movements: MovementType[]
  views: CameraView[]
}

const byCode = (a: string, b: string) => (a === PERSONAL ? 1 : b === PERSONAL ? -1 : a.localeCompare(b))

export function buildLibrary(
  sessions: readonly SessionSummary[],
  attempts: readonly AttemptView[],
  filters: Filters = NO_FILTERS,
  live?: LiveStatus,
  now: Date = new Date(),
): LibraryModel {
  const numbers = sessionNumbers(sessions, attempts)
  const counts: Record<StatusFilter, number> = { all: 0, done: 0, processing: 0, queued: 0, failed: 0 }
  const bySession = new Map<string, Tile[]>()
  const totals = new Map<string, number>()
  let shown = 0
  for (const attempt of attempts) {
    totals.set(attempt.session_id, (totals.get(attempt.session_id) ?? 0) + 1)
    const kind = tileKind(attempt, live)
    if (!matches(attempt, kind, filters, false)) continue
    counts.all++
    counts[tileStatus(kind)]++
    if (!matches(attempt, kind, filters, true)) continue
    shown++
    const list = bySession.get(attempt.session_id)
    if (list) list.push({ attempt, kind })
    else bySession.set(attempt.session_id, [{ attempt, kind }])
  }

  const blocks = new Map<string, SessionBlock[]>()
  for (const session of sessions) {
    const tiles = bySession.get(session.id)
    if (!tiles?.length) continue
    const number = numbers.get(session.id) ?? 1
    const total = totals.get(session.id) ?? tiles.length
    const date = sessionDay(session, tiles.map((t) => t.attempt))
    const block: SessionBlock = {
      session,
      number,
      title: `${MOVEMENT_LABELS[session.movement_type]} · Session ${number}`,
      meta: [formatDate(date, now), viewText(session.camera_view), plural(total, 'attempt'), session.title ?? ''].filter(Boolean).join(' · '),
      date,
      tiles,
      total,
    }
    const key = subjectKey(session)
    const list = blocks.get(key)
    if (list) list.push(block)
    else blocks.set(key, [block])
  }

  const groups = [...blocks.entries()]
    .sort(([a], [b]) => byCode(a, b))
    .map(([key, list]): SubjectGroup => {
      list.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '') || b.session.created_at.localeCompare(a.session.created_at))
      const tiles = list.flatMap((b) => b.tiles)
      const status = groupStatus(tiles)
      return {
        key,
        code: key === PERSONAL ? null : key,
        summary: `${plural(tiles.length, 'clip')} · ${plural(list.length, 'session')}`,
        status,
        sessions: list,
        active: status.status !== 'done',
      }
    })

  return {
    groups,
    counts,
    shown,
    subjects: [...new Set(sessions.map(subjectKey))].sort(byCode),
    movements: [...new Set(sessions.map((s) => s.movement_type))],
    views: [...new Set(sessions.map((s) => s.camera_view).filter((v): v is CameraView => v !== null))],
  }
}

/** Subjects shown before "show more". */
export const GROUP_PAGE = 6

/** 'Show S07–S12 (6 more subjects)' for the groups that are still folded away. */
export function showMoreLabel(hidden: readonly SubjectGroup[]): string {
  const names = hidden.map((g) => g.code ?? PERSONAL_LABEL)
  const range = names.length === 1 ? names[0] : `${names[0]}–${names[names.length - 1]}`
  return `Show ${range} (${names.length} more ${hidden.some((g) => g.code) ? (names.length === 1 ? 'subject' : 'subjects') : 'group'})`
}

/** The attempt a session row opens: what failed first, else the latest processed, else the first. */
export function sessionTarget(block: SessionBlock): AttemptView {
  const failed = block.tiles.find((t) => t.kind === 'failed')
  if (failed) return failed.attempt
  const done = block.tiles.filter((t) => tileStatus(t.kind) === 'done')
  return (done[done.length - 1] ?? block.tiles[0]).attempt
}

// ---------- phone layout: movement groups with one row per session ----------

export interface MobileRow {
  block: SessionBlock
  /** 'Session 3 · Nov 11' */
  title: string
  status: GroupStatus
  attemptId: string
}

export interface MobileGroup {
  key: string
  /** 'Relevé balance', or 'S01 · Relevé balance' when the account has subjects. */
  title: string
  rows: MobileRow[]
}

export function mobileRowStatus(block: SessionBlock): GroupStatus {
  const n = countKinds(block.tiles)
  const view = viewText(block.session.camera_view)
  if (n.failed > 0) return { status: 'failed', text: `${n.failed} failed · tap to see why` }
  const finished = n.done + n.low + n.none
  if (n.processing > 0 || n.queued > 0) {
    return { status: n.processing > 0 ? 'processing' : 'queued', text: `${finished} of ${block.tiles.length} processed · ${view}` }
  }
  const extra = [n.low ? `${n.low} low camera visibility` : '', n.none ? `${n.none} no tracking` : ''].filter(Boolean)
  return { status: 'done', text: [plural(block.tiles.length, 'attempt'), ...(extra.length ? extra : [view])].join(' · ') }
}

export function mobileGroups(groups: readonly SubjectGroup[], now: Date = new Date()): MobileGroup[] {
  const named = groups.some((g) => g.code !== null)
  const out: MobileGroup[] = []
  for (const g of groups) {
    const byMovement = new Map<MovementType, SessionBlock[]>()
    for (const b of g.sessions) {
      const list = byMovement.get(b.session.movement_type)
      if (list) list.push(b)
      else byMovement.set(b.session.movement_type, [b])
    }
    for (const [movement, list] of byMovement) {
      out.push({
        key: `${g.key}|${movement}`,
        title: named ? `${g.code ?? PERSONAL_LABEL} · ${MOVEMENT_LABELS[movement]}` : MOVEMENT_LABELS[movement],
        rows: list.map((block) => ({
          block,
          title: `Session ${block.number} · ${formatDate(block.date, now)}`,
          status: mobileRowStatus(block),
          attemptId: sessionTarget(block).id,
        })),
      })
    }
  }
  return out
}

// ---------- whose trend ----------

export interface Focus {
  /** Subject code, or PERSONAL. */
  key: string
  code: string | null
  movement: MovementType
  /** Sessions and attempts of this one subject only: dancers are never mixed. */
  sessions: SessionSummary[]
  attempts: AttemptView[]
}

/**
 * The one subject and movement the side cards are about: the filtered subject, else the
 * subject of the newest session; the filtered movement, else that subject's newest one.
 */
export function pickFocus(
  sessions: readonly SessionSummary[],
  attempts: readonly AttemptView[],
  filters: Pick<Filters, 'subject' | 'movement'> = NO_FILTERS,
): Focus | null {
  const withAttempts = new Set(attempts.map((a) => a.session_id))
  const usable = sessions.filter((s) => withAttempts.has(s.id))
  const key = filters.subject !== 'all' ? filters.subject : usable[0] ? subjectKey(usable[0]) : null
  if (key === null) return null
  const own = usable.filter((s) => subjectKey(s) === key)
  const movement = filters.movement !== 'all' ? filters.movement : own[0]?.movement_type
  if (!movement) return null
  const ids = new Set(own.map((s) => s.id))
  return { key, code: key === PERSONAL ? null : key, movement, sessions: own, attempts: attempts.filter((a) => ids.has(a.session_id)) }
}

export function metricRows(attempts: readonly AttemptView[]): AttemptMetricsRow[] {
  return attempts.flatMap((a) => (a.metrics ? [a.metrics] : []))
}

// ---------- trend of session medians ----------

export interface TrendPoint {
  sessionId: string
  number: number
  /** 'Session 3', or 'Session 3 · partial'. */
  label: string
  date: DateOnly
  /** Null = the session has no value: a gap, never 0. */
  median: number | null
  text: string
  /** Attempts with status done / all attempts of the session. */
  processed: number
  total: number
  /** Not every attempt is processed yet: drawn hollow and dashed. */
  partial: boolean
  lowConfidence: number
}

export interface Trend {
  series: ProgressSeries
  /** Oldest first; at most `limit` sessions. */
  points: TrendPoint[]
  /** Top of the value axis; null when there is no value to scale by. */
  max: number | null
  /** Neutral sentence about the change, or what is still needed. */
  sentence: string
  /** Why the latest session has no value, when it has none. */
  reason: string | null
  /** Extra lines: partial sessions, sessions left out. */
  notes: string[]
  /** Text alternative of the chart. */
  aria: string
}

/** Hint on a metric card while fewer than two sessions have a value (no chart then). */
export const ONE_SESSION_HINT = 'Record another session to see change.'

/** Fewer than two sessions have a value: show the value alone, not a one-dot chart. */
export function hasSingleValue(trend: Trend): boolean {
  return trend.series.sessions.filter((s) => s.median !== null).length < 2
}

/** The first sentence of a metric description: a one-line plain explanation. */
export function firstSentence(text: string): string {
  const m = /^.*?[.!?](?=\s|$)/.exec(text.trim())
  return m ? m[0] : text.trim()
}

/** A round axis top above the largest value. */
export function niceMax(value: number): number {
  if (!(value > 0)) return 1
  const mag = 10 ** Math.floor(Math.log10(value * 1.1))
  for (const step of [1, 2, 4, 5, 8, 10]) if (step * mag >= value * 1.1) return Number((step * mag).toPrecision(2))
  return 10 * mag
}

/** Why a session has no median, in words about the recording. */
export function noValueReason(points: readonly ProgressPoint[]): string | null {
  const tally = new Map<string, number>()
  for (const p of points) {
    if (!p.gap) continue
    const reason = p.gap.nullReason as NullReason | undefined
    const text = reason && NULL_REASON_TEXT[reason] ? NULL_REASON_TEXT[reason] : `${gapText(p.gap)}.`
    tally.set(text, (tally.get(text) ?? 0) + 1)
  }
  let best: string | null = null
  for (const [text, n] of tally) if (best === null || n > tally.get(best)!) best = text
  if (best === null && points.some((p) => p.lowConfidence)) return 'Only values with low camera visibility, which are not part of the median.'
  return best
}

export function buildTrend(focus: Focus, metric: MetricKey, limit = 6, now: Date = new Date()): Trend {
  const series = progressSeries(focus.sessions, focus.attempts, metricRows(focus.attempts), { movement: focus.movement, metric })
  const numbers = sessionNumbers(focus.sessions, focus.attempts)
  const shown = series.sessions.slice(-limit)
  const points = shown.map((s): TrendPoint => {
    const own = focus.attempts.filter((a) => a.session_id === s.sessionId)
    const processed = own.filter((a) => a.status === 'done').length
    const number = numbers.get(s.sessionId) ?? 1
    const partial = processed < own.length
    return {
      sessionId: s.sessionId,
      number,
      label: `Session ${number}${partial ? ' · partial' : ''}`,
      date: s.date,
      median: s.median,
      text: s.medianText,
      processed,
      total: own.length,
      partial,
      lowConfidence: s.points.filter((p) => p.lowConfidence).length,
    }
  })
  const values = points.flatMap((p) => (p.median === null ? [] : [p.median]))
  const latest = shown[shown.length - 1]
  const reason = latest && latest.median === null ? noValueReason(latest.points) : null

  const sentence =
    series.state === 'ready'
      ? `${prettyDates(series.change.text, now)}.`
      : series.state === 'needs_two_sessions'
        ? `${NEEDS_TWO_SESSIONS_TEXT}.`
        : series.state === 'not_applicable'
          ? 'Not measured for this movement.'
          : 'No session has a value for this yet.'

  const notes: string[] = []
  for (const p of points) if (p.partial) notes.push(`Session ${p.number} has ${p.processed} of ${plural(p.total, 'attempt')} processed.`)
  const low = points.reduce((n, p) => n + p.lowConfidence, 0)
  if (low > 0) notes.push(`${plural(low, 'value')} with low camera visibility not in the medians.`)
  const otherView = series.excluded.filter((e) => e.reason === 'different_camera_view' || e.reason === 'unknown_camera_view')
  if (otherView.length) notes.push(`${plural(otherView.length, 'session')} ${exclusionText(otherView[0].reason).replace(/^Not shown/, 'not shown')}.`)

  const label = METRICS[metric].label
  const aria = points.length
    ? `${label}, session medians: ${points
        .map((p) => `session ${p.number} ${p.median === null ? 'no value' : p.text}${p.partial ? ` (${p.processed} of ${p.total} attempts processed)` : ''}`)
        .join(', ')}.`
    : `${label}: no sessions to show.`

  return { series, points, max: values.length ? niceMax(Math.max(...values)) : null, sentence, reason, notes, aria }
}

// ---------- next focus, from the latest stored practice notes ----------

const PHASE_SHORT: Record<Phase, string> = { prep: 'Prep', rise: 'Rise', hold: 'Hold', turn: 'Turn', finish: 'Fin.', recovery: 'Rec.' }

export interface FocusRibbonPhase {
  label: string
  flex: number
  current: boolean
}

export interface NextFocus {
  attemptId: string
  code: string | null
  /** 'Hold phase — trunk inclination', or the metric's name when its phase isn't stored. */
  title: string
  /** The note's own observation and suggestion, unedited. */
  observation: string
  suggestion: string
  /** 'From notes, Nov 4' */
  from: string
  /** The attempt's detected phases with the metric's phase marked; null without phases. */
  ribbon: FocusRibbonPhase[] | null
  /** The measured value the note is about, e.g. '4.2°'; '—' when it has none. */
  valueText: string
}

/** Newest note first; notes whose attempt is no longer in the library are skipped. */
export function nextFocus(notes: readonly FeedbackNote[], attempts: readonly AttemptView[], subject?: string, now: Date = new Date()): NextFocus | null {
  const byId = new Map(attempts.map((a) => [a.id, a]))
  const sorted = [...notes].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  for (const note of sorted) {
    const attempt = byId.get(note.attemptId)
    const first = note.response.observations[0]
    if (!attempt || !first) continue
    if (subject && subject !== 'all' && subjectKey(attempt.session) !== subject) continue
    const key = first.metric as MetricKey
    const def = METRICS[key]
    if (!def) continue
    const reading = readMetric(attempt.metrics, key)
    const phaseNames = reading.phases.map((p) => PHASE_LABELS[p]).join(' + ')
    const spans = (attempt.metrics?.phases ?? []).filter((p) => p.end > p.start)
    return {
      attemptId: attempt.id,
      code: attempt.session.subject_code,
      title: phaseNames ? `${phaseNames} phase — ${def.label.toLowerCase()}` : def.label,
      observation: first.observation,
      suggestion: first.suggestion,
      from: `From notes, ${formatDate(note.createdAt, now)}`,
      ribbon: spans.length
        ? spans.map((p) => ({ label: PHASE_SHORT[p.phase] ?? p.phase, flex: Math.max(1, Math.round((p.end - p.start) * 10)), current: reading.phases.includes(p.phase) }))
        : null,
      valueText: formatMetricWithUnit(key, reading.value),
    }
  }
  return null
}

// ---------- recent notes (Dashboard) ----------

export interface NoteLine {
  id: string
  attemptId: string
  /** 'Session 2 · Attempt 3' (with the subject code in front when there is one). */
  title: string
  /** 'Nov 4 · 3 observations' */
  meta: string
}

export function recentNotes(
  notes: readonly FeedbackNote[],
  sessions: readonly SessionSummary[],
  attempts: readonly AttemptView[],
  limit = 3,
  now: Date = new Date(),
): NoteLine[] {
  const byId = new Map(attempts.map((a) => [a.id, a]))
  const numbers = sessionNumbers(sessions, attempts)
  const out: NoteLine[] = []
  for (const note of [...notes].sort((a, b) => b.createdAt.localeCompare(a.createdAt))) {
    const attempt = byId.get(note.attemptId)
    if (!attempt) continue
    const code = attempt.session.subject_code
    out.push({
      id: note.id,
      attemptId: attempt.id,
      title: `${code ? `${code} · ` : ''}Session ${numbers.get(attempt.session_id) ?? 1} · Attempt ${attempt.number}`,
      meta: `${formatDate(note.createdAt, now)} · ${plural(note.response.observations.length, 'observation')}`,
    })
    if (out.length >= limit) break
  }
  return out
}
