// View-model of the Dashboard: pure functions from the loaded rows to what the cards
// print. Counts, practice days and latest medians come from `dashboardSummary`; change
// sentences from `progressSeries`. Values and neutral differences only — no scores, no
// ranking between subjects.

import type { SessionSummary } from '../../../data/repo'
import type { MovementType } from '../../../data/schema'
import type { FeedbackNote } from '../../../feedback/client'
import { dashboardSummary, localDay } from '../../../insights'
import type { DashboardSummary } from '../../../insights'
import type { AttemptView } from '../../data'
import { METRICS, MOVEMENT_LABELS, formatDate, formatDateTime, formatMetric, metricsFor, readMetrics, type MetricKey } from '../../format'
import type { PipelineItem } from '../../pipeline'
import {
  ONE_SESSION_HINT,
  PERSONAL,
  TILE_LABEL,
  buildTrend,
  countKinds,
  firstSentence,
  hasSingleValue,
  metricRows,
  plural,
  prettyDates,
  sessionNumbers,
  subjectKey,
  tileKind,
  viewText,
  type Focus,
  type LiveStatus,
  type Tile,
  type TileKind,
  type Trend,
} from '../library/model'

export function accountSummary(sessions: readonly SessionSummary[], attempts: readonly AttemptView[], now: Date = new Date()): DashboardSummary {
  return dashboardSummary(sessions, attempts, metricRows(attempts), { now })
}

/** 'Practice recorded on 2 of the last 14 days · last on Nov 11'. */
export function practiceLine(summary: DashboardSummary, now: Date = new Date()): string {
  const days = summary.practiceDays.length
  const base = `Practice recorded on ${summary.practiceDayCount} of the last ${days} days`
  return summary.lastPracticeDate ? `${base} · last on ${formatDate(summary.lastPracticeDate, now)}` : base
}

// ---------- latest session ----------

export interface LatestSession {
  session: SessionSummary
  code: string | null
  /** 'Relevé balance · Session 3' */
  title: string
  /** 'Nov 11 · side view' */
  when: string
  /** '5 attempts' */
  attemptsText: string
  tiles: Tile[]
  /** '2 done · 2 processing · 1 queued' */
  statusLine: string
  /** The latest processed attempt of the session; null when none is processed yet. */
  review: AttemptView | null
}

export function statusLine(tiles: readonly Tile[]): string {
  const n = countKinds(tiles)
  const done = n.done + n.low + n.none
  return [
    done ? `${done} done` : '',
    n.none ? `${n.none} with no tracking` : '',
    n.low ? `${n.low} low confidence` : '',
    n.processing ? `${n.processing} processing` : '',
    n.queued ? `${n.queued} queued` : '',
    n.failed ? `${n.failed} failed` : '',
  ]
    .filter(Boolean)
    .join(' · ')
}

/** The newest session that has attempts. */
export function latestSession(
  sessions: readonly SessionSummary[],
  attempts: readonly AttemptView[],
  live?: LiveStatus,
  now: Date = new Date(),
): LatestSession | null {
  const numbers = sessionNumbers(sessions, attempts)
  for (const session of sessions) {
    const own = attempts.filter((a) => a.session_id === session.id)
    if (!own.length) continue
    const tiles = own.map((attempt): Tile => ({ attempt, kind: tileKind(attempt, live) }))
    const done = own.filter((a) => a.status === 'done')
    const day = session.recorded_on ?? localDay([...own].map((a) => a.created_at).sort()[0])
    return {
      session,
      code: session.subject_code,
      title: `${MOVEMENT_LABELS[session.movement_type]} · Session ${numbers.get(session.id) ?? 1}`,
      when: `${formatDate(day, now)} · ${viewText(session.camera_view)}`,
      attemptsText: plural(own.length, 'attempt'),
      tiles,
      statusLine: statusLine(tiles),
      review: done[done.length - 1] ?? null,
    }
  }
  return null
}

// ---------- metric tiles: latest session median + medians by session ----------

export type TileConfidence = 'high' | 'medium' | 'low' | 'none'

export interface MetricTile {
  metric: MetricKey
  name: string
  /** '4.9', or '—' when no session has a value. Never 0 for a gap. */
  value: string
  unit: string
  /** No session has a value. */
  none: boolean
  /** Low-confidence values exist in the session the value comes from (dashed card). */
  low: boolean
  confidence: TileConfidence
  /** 'High' | 'Medium' | 'Mixed' | 'No tracking' */
  confidenceLabel: string
  /** Neutral change sentence, or what is still needed; null when there is no value. */
  delta: string | null
  /** Hatched line: why there is no value, or what is left out of the median. */
  note: string | null
  /** Fewer than two sessions have a value: the card shows the value alone, no mini chart. */
  single: boolean
  /** One plain line on what the measurement is (first sentence of its description). */
  about: string
  trend: Trend
}

export interface MetricTiles {
  /** 'Relevé balance · by session' */
  heading: string
  tiles: MetricTile[]
  /** 'Session medians: Oct 28 → Nov 4 → Nov 11 (2 of 5 attempts processed so far). …' */
  caption: string
}

export function metricTiles(focus: Focus, now: Date = new Date()): MetricTiles {
  const summary = dashboardSummary(focus.sessions, focus.attempts, metricRows(focus.attempts), { now })
  const tiles = metricsFor(focus.movement).map((metric): MetricTile => {
    const def = METRICS[metric]
    const trend = buildTrend(focus, metric, 6, now)
    const latest = summary.latestMedians.find((m) => m.movement === focus.movement && m.metric === metric)
    const median = latest?.median ?? null
    const source = trend.series.sessions.find((s) => s.sessionId === latest?.sessionId)
    const lowCount = source?.points.filter((p) => p.lowConfidence).length ?? 0
    const counted = source?.points.filter((p) => p.counted) ?? []
    const none = median === null
    const single = hasSingleValue(trend)
    const confidence: TileConfidence = none ? 'none' : lowCount > 0 ? 'low' : counted.some((p) => p.confidence === 'medium') ? 'medium' : 'high'
    const note = none
      ? (trend.reason ?? 'No measurements yet.')
      : lowCount > 0
        ? `${plural(lowCount, 'attempt')} on ${formatDate(source!.date, now)} had low confidence and ${lowCount === 1 ? 'is' : 'are'} not in the median.`
        : trend.reason
          ? `Latest session has no value. ${trend.reason}`
          : null
    return {
      metric,
      name: def.label,
      value: formatMetric(metric, median),
      unit: def.unitShort.trim() || def.unit,
      none,
      low: !none && lowCount > 0,
      confidence,
      confidenceLabel: { high: 'Clear view', medium: 'Partly hidden', low: 'Mixed view', none: 'Not seen' }[confidence],
      delta: none ? null : single ? ONE_SESSION_HINT : prettyDates(trend.series.change.text, now),
      note,
      single,
      about: firstSentence(def.description),
      trend,
    }
  })

  const points = tiles[0]?.trend.points ?? []
  const last = points[points.length - 1]
  // Two sessions on the same day would read 'Nov 15 → Nov 15': name them by number then.
  const days = points.map((p) => formatDate(p.date, now))
  const dates = (new Set(days).size === days.length ? days : points.map((p) => `Session ${p.number} (${formatDate(p.date, now)})`)).join(' → ')
  const partial = last?.partial ? ` (${last.processed} of ${plural(last.total, 'attempt')} processed so far)` : ''
  return {
    heading: `${MOVEMENT_LABELS[focus.movement]} · by session`,
    tiles,
    caption: points.length
      ? `Session medians: ${dates}${partial}. Compared with your own first session only.`
      : 'Session medians appear here once a session has attempts.',
  }
}

// ---------- the other movement ----------

const HEADLINE: Record<MovementType, MetricKey> = { releve_balance: 'balance_duration_s', pirouette: 'turn_count' }

export interface MovementCard {
  movement: MovementType
  title: string
  sessions: number
  metric: MetricKey
  /** Median of the latest session with one; '—' when there is none. */
  value: string
  /** 'turns · median' */
  unit: string
  sentence: string
  reason: string | null
}

/** The movement the tiles are not about, for the same subject. */
export function otherMovement(focus: Focus, now: Date = new Date()): MovementCard {
  const movement: MovementType = focus.movement === 'pirouette' ? 'releve_balance' : 'pirouette'
  const metric = HEADLINE[movement]
  const own = focus.sessions.filter((s) => s.movement_type === movement)
  const trend = buildTrend({ ...focus, movement }, metric, 6, now)
  const withValue = [...trend.series.sessions].reverse().find((s) => s.median !== null)
  const def = METRICS[metric]
  return {
    movement,
    title: MOVEMENT_LABELS[movement],
    sessions: own.length,
    metric,
    value: formatMetric(metric, withValue?.median ?? null),
    unit: `${def.unitShort.trim() || def.unit} · median`,
    sentence: own.length === 0 ? `No ${MOVEMENT_LABELS[movement].toLowerCase()} sessions yet.` : `${def.label}: ${trend.sentence.charAt(0).toLowerCase()}${trend.sentence.slice(1)}`,
    reason: own.length === 0 ? null : withValue ? null : (trend.reason ?? 'No measurements yet.'),
  }
}

// ---------- processing ----------

export interface ProcessingSummary {
  processing: number
  queued: number
  /** Not processed and not in this tab's queue: their files have to be chosen again. */
  waiting: number
  failed: number
  done: number
  total: number
  /** One sentence for the card. */
  line: string
  /** 0..100 of this tab's queue; null when the queue is empty. */
  percent: number | null
  /** 'Attempt 3 · 74%' for the clip in progress. */
  active: string | null
}

export function processingSummary(attempts: readonly AttemptView[], items: readonly PipelineItem[]): ProcessingSummary {
  const byId = new Map(attempts.map((a) => [a.id, a]))
  const mine = items.filter((i) => i.status !== 'cancelled' && byId.has(i.attemptId))
  const processing = mine.filter((i) => i.status === 'processing')
  const queued = mine.filter((i) => i.status === 'queued')
  const inQueue = new Set([...processing, ...queued].map((i) => i.attemptId))
  const done = attempts.filter((a) => a.status === 'done').length
  const failed = attempts.filter((a) => a.status === 'failed' && !inQueue.has(a.id)).length
  const waiting = attempts.filter((a) => a.status !== 'done' && a.status !== 'failed' && !inQueue.has(a.id)).length
  const busy = processing.length + queued.length

  let line: string
  if (busy > 0) {
    line = [
      processing.length ? `${plural(processing.length, 'clip')} processing on this device` : '',
      queued.length ? `${queued.length} queued` : '',
    ]
      .filter(Boolean)
      .join(', ')
  } else if (waiting > 0) {
    line = `${plural(waiting, 'clip')} ${waiting === 1 ? 'is' : 'are'} waiting. Choose ${waiting === 1 ? 'its file' : 'their files'} again to process ${waiting === 1 ? 'it' : 'them'} on this device.`
  } else if (attempts.length > 0) {
    line = `Nothing in the queue. ${done} of ${plural(attempts.length, 'clip')} processed.`
  } else {
    line = 'Nothing in the queue.'
  }
  if (failed > 0) line += ` ${failed} failed.`

  const finished = mine.filter((i) => i.status === 'done' || i.status === 'failed').length
  const partial = processing.reduce((sum, i) => sum + Math.min(1, Math.max(0, i.fraction)), 0)
  const first = processing[0]
  const a = first ? byId.get(first.attemptId) : undefined
  return {
    processing: processing.length,
    queued: queued.length,
    waiting,
    failed,
    done,
    total: attempts.length,
    line,
    percent: busy > 0 && mine.length > 0 ? Math.round(((finished + partial) / mine.length) * 100) : null,
    active: first && a ? `${a.session.subject_code ? `${a.session.subject_code} · ` : ''}Attempt ${a.number} · ${Math.round(first.fraction * 100)}%` : null,
  }
}

// ---------- researcher: study progress ----------

export interface StudyProgress {
  total: number
  done: number
  processing: number
  queued: number
  failed: number
  /** Finished clips with low confidence or no tracking. */
  flagged: number
  subjects: number
  sessions: number
  /** ISO time of the latest metrics run; null when nothing is processed. */
  lastProcessed: string | null
  percent: number
}

export function studyProgress(sessions: readonly SessionSummary[], attempts: readonly AttemptView[], live?: LiveStatus, now: Date = new Date()): StudyProgress {
  const summary = accountSummary(sessions, attempts, now)
  const kinds = countKinds(attempts.map((attempt) => ({ attempt, kind: tileKind(attempt, live) })))
  let last: string | null = null
  for (const a of attempts) {
    const at = a.metrics?.computed_at
    if (at && (!last || at > last)) last = at
  }
  return {
    total: summary.attempts,
    done: summary.attemptsProcessed,
    processing: kinds.processing,
    queued: kinds.queued,
    failed: kinds.failed,
    flagged: kinds.low + kinds.none,
    subjects: new Set(sessions.map((s) => s.subject_code).filter(Boolean)).size,
    sessions: summary.sessions,
    lastProcessed: last,
    percent: summary.attempts ? (summary.attemptsProcessed / summary.attempts) * 100 : 0,
  }
}

// ---------- researcher: needs attention (system issues only) ----------

export interface AttentionItem {
  attemptId: string
  code: string | null
  /** File name, or 'Attempt 3' when the clip has none. */
  clip: string
  kind: TileKind
  status: string
  reason: string
  action: 'Retry' | 'Review'
}

export function attentionReason(attempt: AttemptView, kind: TileKind): string {
  if (kind === 'failed') return attempt.error?.trim() || 'Processing did not finish for this clip.'
  const readings = readMetrics(attempt.metrics, attempt.session.movement_type)
  if (kind === 'none') return readings.find((r) => r.reason)?.reason ?? 'No metric has a value for this clip.'
  const low = readings.filter((r) => r.confidence === 'low').map((r) => r.def.label)
  return `Low tracking confidence: ${low.join(', ')}.`
}

/** Failed clips first, then finished clips with no tracking or low confidence; newest first inside each. */
export function attentionItems(attempts: readonly AttemptView[], live?: LiveStatus): AttentionItem[] {
  const order: Partial<Record<TileKind, number>> = { failed: 0, none: 1, low: 2 }
  return attempts
    .map((attempt) => ({ attempt, kind: tileKind(attempt, live) }))
    .filter((t) => t.kind in order)
    .sort((a, b) => order[a.kind]! - order[b.kind]! || b.attempt.created_at.localeCompare(a.attempt.created_at))
    .map(({ attempt, kind }) => ({
      attemptId: attempt.id,
      code: attempt.session.subject_code,
      clip: attempt.clip_name?.split(/[\\/]/).pop() || `Attempt ${attempt.number}`,
      kind,
      status: TILE_LABEL[kind],
      reason: attentionReason(attempt, kind),
      action: kind === 'failed' ? 'Retry' : 'Review',
    }))
}

// ---------- researcher: subjects (ordered by code, not a ranking) ----------

export interface SubjectProgress {
  key: string
  code: string | null
  done: number
  total: number
  percent: number
  /** '12 / 15' */
  label: string
}

export function subjectProgress(attempts: readonly AttemptView[]): SubjectProgress[] {
  const map = new Map<string, { done: number; total: number }>()
  for (const a of attempts) {
    const key = subjectKey(a.session)
    const cur = map.get(key) ?? { done: 0, total: 0 }
    cur.total++
    if (a.status === 'done') cur.done++
    map.set(key, cur)
  }
  return [...map.entries()]
    .sort(([a], [b]) => (a === PERSONAL ? 1 : b === PERSONAL ? -1 : a.localeCompare(b)))
    .map(([key, v]) => ({
      key,
      code: key === PERSONAL ? null : key,
      done: v.done,
      total: v.total,
      percent: v.total ? (v.done / v.total) * 100 : 0,
      label: `${v.done} / ${v.total}`,
    }))
}

// ---------- researcher: recent activity, read from the rows themselves ----------

export interface ActivityEvent {
  key: string
  /** ISO timestamp. */
  at: string
  when: string
  what: string
}

export function recentActivity(
  sessions: readonly SessionSummary[],
  attempts: readonly AttemptView[],
  notes: readonly FeedbackNote[],
  limit = 6,
): ActivityEvent[] {
  const events: Omit<ActivityEvent, 'when'>[] = []
  const who = (code: string | null) => (code ? ` for ${code}` : '')
  for (const s of sessions) {
    const own = attempts.filter((a) => a.session_id === s.id)
    if (!own.length) continue
    events.push({ key: `i-${s.id}`, at: s.created_at, what: `${plural(own.length, 'clip')} imported${who(s.subject_code)} · ${MOVEMENT_LABELS[s.movement_type]}.` })
    const runs = own.flatMap((a) => (a.metrics ? [a.metrics.computed_at] : [])).sort()
    if (runs.length) {
      const failed = own.filter((a) => a.status === 'failed').length
      events.push({
        key: `m-${s.id}`,
        at: runs[runs.length - 1],
        what: `${plural(runs.length, 'clip')} processed${who(s.subject_code)} · ${MOVEMENT_LABELS[s.movement_type]}${failed ? `, ${failed} failed` : ''}.`,
      })
    }
  }
  const byId = new Map(attempts.map((a) => [a.id, a]))
  for (const n of notes) {
    const a = byId.get(n.attemptId)
    if (a) events.push({ key: `n-${n.id}`, at: n.createdAt, what: `Practice notes written${who(a.session.subject_code)} · attempt ${a.number}.` })
  }
  return events
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, limit)
    .map((e) => ({ ...e, when: formatDateTime(e.at) }))
}
