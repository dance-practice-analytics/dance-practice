// One metric over time for one movement (FR-3.6.3, FR-3.6.4): a point per attempt,
// grouped by session, with the session median. Like with like only: one movement, one
// camera view. Gaps stay gaps.

import type { AttemptMetricsRow, AttemptRow, CameraView, ConfidenceLevel, DateOnly, MovementType, SessionRow, Timestamp } from '../data/schema'
import type { MetricKey } from '../metrics/types'
import { METRIC_CATALOG, formatValue, roundValue } from './catalog'
import type { MetricInfo } from './catalog'
import { NO_DIFFERENCE_TEXT, describeDifference } from './compare'
import type { Direction } from './compare'
import { byCreated, median, readConfidence, readValue, sessionDay } from './util'

export interface ProgressOptions {
  movement: MovementType
  metric: MetricKey
  /** Camera view to show. Default: the view most sessions were filmed from (see `pickView`). */
  cameraView?: CameraView
  /** Inclusive session-day range, YYYY-MM-DD. */
  from?: DateOnly
  to?: DateOnly
  /** IANA zone for days derived from timestamps. Default: the device's zone. */
  timeZone?: string
}

export type GapCode =
  /** Queued, still processing, or done without a metrics row. */
  | 'not_processed'
  /** Attempt status is 'failed'. */
  | 'processing_failed'
  /** The metrics row belongs to another movement than the session being shown. */
  | 'different_movement'
  /** The metric is null; `nullReason` carries the engine's reason when stored. */
  | 'no_value'

export interface Gap {
  code: GapCode
  nullReason?: string
}

export interface ProgressPoint {
  attemptId: string
  sessionId: string
  label: string | null
  /** The session's day (x position). */
  date: DateOnly
  /** The attempt's `created_at` (order inside the session). */
  at: Timestamp
  /** Null = gap; see `gap`. Never 0 for a missing value. */
  value: number | null
  gap: Gap | null
  confidence: ConfidenceLevel | null
  /** Value present but tracking confidence is low: draw it hatched/greyed. */
  lowConfidence: boolean
  /** Whether the value is part of the session median. */
  counted: boolean
}

export interface ProgressSession {
  sessionId: string
  title: string | null
  date: DateOnly
  cameraView: CameraView | null
  points: ProgressPoint[]
  /** Median of the counted values (unrounded); null when there are none. */
  median: number | null
  medianText: string
  countedValues: number
}

export type ExclusionCode = 'different_movement' | 'different_camera_view' | 'unknown_camera_view' | 'outside_date_range' | 'no_attempts' | 'no_date'

export interface ExcludedSession {
  sessionId: string
  reason: ExclusionCode
  movement: MovementType
  cameraView: CameraView | null
  date: DateOnly | null
}

export interface SessionMedian {
  sessionId: string
  date: DateOnly
  median: number
}

export interface SessionChange {
  state: 'needs_two_sessions' | 'ready'
  first: SessionMedian | null
  latest: SessionMedian | null
  /** latest − first of the rounded medians; null until there are two sessions. */
  difference: number | null
  direction: Direction | null
  text: string
}

export type ProgressState =
  /** The metric is not measured for this movement. */
  | 'not_applicable'
  /** No session has a value. */
  | 'no_data'
  /** Exactly one session has a value. */
  | 'needs_two_sessions'
  | 'ready'

export interface ProgressSeries {
  movement: MovementType
  metric: MetricKey
  info: MetricInfo
  /** The one view shown; 'unknown' when no session has a recorded view; null when empty. */
  cameraView: CameraView | 'unknown' | null
  state: ProgressState
  /** Oldest first. */
  sessions: ProgressSession[]
  /** Every point of `sessions`, in order. */
  points: ProgressPoint[]
  excluded: ExcludedSession[]
  change: SessionChange
}

export const NEEDS_TWO_SESSIONS_TEXT = 'Needs two sessions with a value to show change'

const EXCLUSION_TEXT: Record<ExclusionCode, string> = {
  different_movement: 'Not shown: a different movement',
  different_camera_view: 'Not shown: filmed from a different camera view',
  unknown_camera_view: 'Not shown: the camera view was not recorded',
  outside_date_range: 'Not shown: outside the selected dates',
  no_attempts: 'Not shown: the session has no attempts',
  no_date: 'Not shown: the session has no date',
}

export function exclusionText(reason: ExclusionCode): string {
  return EXCLUSION_TEXT[reason]
}

const GAP_TEXT: Record<GapCode, string> = {
  not_processed: 'No measurements yet',
  processing_failed: 'Processing did not finish for this clip',
  different_movement: 'Measured as a different movement',
  no_value: 'Not available for this attempt',
}

export function gapText(gap: Gap): string {
  return GAP_TEXT[gap.code]
}

interface Candidate {
  session: SessionRow
  attempts: AttemptRow[]
  date: DateOnly
}

/**
 * The view to show when none is asked for: the known view with the most sessions; on a
 * tie, the view of the most recent of the tied sessions. Sessions without a recorded
 * view are only used when no session has one.
 */
export function pickView(sessions: readonly { camera_view: CameraView | null; date: DateOnly }[]): CameraView | 'unknown' | null {
  if (!sessions.length) return null
  const stats = new Map<CameraView, { count: number; latest: DateOnly }>()
  for (const s of sessions) {
    if (!s.camera_view) continue
    const cur = stats.get(s.camera_view)
    if (cur) {
      cur.count++
      if (s.date > cur.latest) cur.latest = s.date
    } else stats.set(s.camera_view, { count: 1, latest: s.date })
  }
  let best: CameraView | null = null
  for (const [view, st] of stats) {
    const b = best ? stats.get(best)! : null
    if (!b || st.count > b.count || (st.count === b.count && st.latest > b.latest)) best = view
  }
  return best ?? 'unknown'
}

/** First session with a median against the latest one, as neutral text. */
export function changeBetweenSessions(sessions: readonly ProgressSession[], metric: MetricKey): SessionChange {
  const withMedian = sessions
    .filter((s) => s.median !== null)
    .map((s): SessionMedian => ({ sessionId: s.sessionId, date: s.date, median: s.median! }))
  const first = withMedian[0] ?? null
  if (withMedian.length < 2) {
    return { state: 'needs_two_sessions', first, latest: null, difference: null, direction: null, text: NEEDS_TWO_SESSIONS_TEXT }
  }
  const latest = withMedian[withMedian.length - 1]
  const difference = roundValue(metric, roundValue(metric, latest.median) - roundValue(metric, first!.median))
  const size = describeDifference(metric, difference)
  return {
    state: 'ready',
    first,
    latest,
    difference,
    direction: difference === 0 ? 'same' : difference < 0 ? 'less' : 'more',
    text:
      size === null
        ? `${NO_DIFFERENCE_TEXT} between ${first!.date} and ${latest.date}`
        : `Median on ${latest.date} is ${size} than on ${first!.date}`,
  }
}

export function progressSeries(
  sessions: readonly SessionRow[],
  attempts: readonly AttemptRow[],
  metrics: readonly AttemptMetricsRow[],
  options: ProgressOptions,
): ProgressSeries {
  const { movement, metric, timeZone } = options
  const info = METRIC_CATALOG[metric]
  const empty = (state: ProgressState): ProgressSeries => ({
    movement,
    metric,
    info,
    cameraView: null,
    state,
    sessions: [],
    points: [],
    excluded: [],
    change: changeBetweenSessions([], metric),
  })
  if (!info.movements.includes(movement)) return empty('not_applicable')

  const metricsByAttempt = new Map(metrics.map((m) => [m.attempt_id, m]))
  const attemptsBySession = new Map<string, AttemptRow[]>()
  for (const a of attempts) {
    const list = attemptsBySession.get(a.session_id)
    if (list) list.push(a)
    else attemptsBySession.set(a.session_id, [a])
  }

  const excluded: ExcludedSession[] = []
  const candidates: Candidate[] = []
  for (const session of sessions) {
    const own = [...(attemptsBySession.get(session.id) ?? [])].sort(byCreated)
    const date = sessionDay(session, own, timeZone)
    const out = (reason: ExclusionCode) =>
      excluded.push({ sessionId: session.id, reason, movement: session.movement_type, cameraView: session.camera_view, date })
    if (session.movement_type !== movement) out('different_movement')
    else if (!own.length) out('no_attempts')
    else if (!date) out('no_date')
    else if ((options.from && date < options.from) || (options.to && date > options.to)) out('outside_date_range')
    else candidates.push({ session, attempts: own, date })
  }

  const view = options.cameraView ?? pickView(candidates.map((c) => ({ camera_view: c.session.camera_view, date: c.date })))
  if (view === null) return { ...empty('no_data'), excluded }

  const shown = candidates.filter((c) => {
    const v = c.session.camera_view
    if (view === 'unknown' ? v === null : v === view) return true
    excluded.push({
      sessionId: c.session.id,
      reason: v === null ? 'unknown_camera_view' : 'different_camera_view',
      movement: c.session.movement_type,
      cameraView: v,
      date: c.date,
    })
    return false
  })
  shown.sort((a, b) => a.date.localeCompare(b.date) || a.session.created_at.localeCompare(b.session.created_at) || a.session.id.localeCompare(b.session.id))

  const out = shown.map((c): ProgressSession => {
    const points = c.attempts.map((attempt): ProgressPoint => {
      const row = metricsByAttempt.get(attempt.id)
      const base = { attemptId: attempt.id, sessionId: c.session.id, label: attempt.label, date: c.date, at: attempt.created_at }
      const gapPoint = (gap: Gap): ProgressPoint => ({ ...base, value: null, gap, confidence: null, lowConfidence: false, counted: false })
      if (!row) return gapPoint({ code: attempt.status === 'failed' ? 'processing_failed' : 'not_processed' })
      if (row.movement !== movement) return gapPoint({ code: 'different_movement' })
      const value = readValue(row, metric)
      const conf = readConfidence(row, metric)
      if (value === null) return gapPoint(conf.nullReason ? { code: 'no_value', nullReason: conf.nullReason } : { code: 'no_value' })
      const lowConfidence = conf.level === 'low'
      return { ...base, value, gap: null, confidence: conf.level, lowConfidence, counted: !lowConfidence }
    })
    const counted = points.filter((p) => p.counted).map((p) => p.value!)
    const med = median(counted)
    return {
      sessionId: c.session.id,
      title: c.session.title,
      date: c.date,
      cameraView: c.session.camera_view,
      points,
      median: med,
      medianText: formatValue(metric, med),
      countedValues: counted.length,
    }
  })

  const withMedian = out.filter((s) => s.median !== null).length
  return {
    movement,
    metric,
    info,
    cameraView: view,
    state: withMedian === 0 ? 'no_data' : withMedian === 1 ? 'needs_two_sessions' : 'ready',
    sessions: out,
    points: out.flatMap((s) => s.points),
    excluded,
    change: changeBetweenSessions(out, metric),
  }
}
