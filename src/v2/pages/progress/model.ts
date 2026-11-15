// View model of the Progress screen (FR-3.6.3, FR-3.6.4). Every number and sentence
// comes from src/insights/progress.ts; this file only picks the filters, lays the
// points out on the design's 300 × 120 chart and words the captions. Nothing grades.

import type { AttemptMetricsRow, CameraView, MovementType } from '../../../data/schema'
import {
  exclusionText,
  gapText,
  progressSeries,
  type ExcludedSession,
  type Gap,
  type ProgressPoint,
  type ProgressSeries,
  type ProgressSession,
} from '../../../insights'
import type { AttemptView } from '../../data'
import {
  formatDate,
  formatMetricWithUnit,
  metricsFor,
  METRICS,
  MOVEMENT_LABELS,
  NULL_REASON_TEXT,
  PHASE_LABELS,
  readMetric,
  VIEW_LABELS,
  type MetricKey,
  type NullReason,
  type Phase,
} from '../../format'
import type { SessionSummary } from '../../../data/repo'

// ---------- chart geometry (the design's viewBox) ----------

export const CHART = { width: 300, height: 120, left: 34, right: 300, top: 10, bottom: 100, gapY: 55 } as const

export interface ChartDot {
  attemptId: string
  x: number
  y: number
  /** Low confidence: hollow, dashed, not part of the median. */
  low: boolean
}

export interface ChartGapMark {
  attemptId: string
  x: number
  y: number
}

export interface ChartColumn {
  sessionId: string
  /** Centre of the session's column. */
  cx: number
  /** Some attempts of the session have no measurements yet. */
  partial: boolean
  /** The median tick, or null when the session has no counted value. */
  tick: { x1: number; x2: number; y: number } | null
}

export interface ChartGeometry {
  /** Scale shared by every session of the chart; null when there is no value at all. */
  min: number | null
  max: number | null
  columns: ChartColumn[]
  dots: ChartDot[]
  gaps: ChartGapMark[]
  /** One SVG path per run of neighbouring sessions that have a median; a session without one breaks the line. */
  medianPaths: string[]
}

/** Smallest of 1, 2, 2.5, 5, 10 × 10^k that is ≥ v, so the top label is a round number. */
export function niceCeil(v: number): number {
  if (!(v > 0)) return 1
  const pow = 10 ** Math.floor(Math.log10(v))
  for (const m of [1, 2, 2.5, 5, 10]) {
    // The epsilon keeps 0.2 from becoming 0.25 through floating point noise.
    if (m * pow >= v - pow * 1e-9) return Number((m * pow).toPrecision(12))
  }
  return 10 * pow
}

const r1 = (v: number) => Math.round(v * 10) / 10

function isPending(gap: Gap | null): boolean {
  return gap?.code === 'not_processed' || gap?.code === 'processing_failed'
}

export function isPartial(session: ProgressSession): boolean {
  return session.points.some((p) => isPending(p.gap))
}

export function chartGeometry(sessions: readonly ProgressSession[]): ChartGeometry {
  const values = sessions.flatMap((s) => s.points).flatMap((p) => (p.value === null ? [] : [p.value]))
  const hasValues = values.length > 0
  // The scale starts at 0 like the design; it only goes below for a signed value.
  const max = hasValues ? niceCeil(Math.max(...values, 0)) : null
  const lowest = hasValues ? Math.min(...values) : 0
  const min = hasValues ? (lowest < 0 ? -niceCeil(-lowest) : 0) : null
  const y = (v: number) => r1(CHART.bottom - ((v - min!) / (max! - min!)) * (CHART.bottom - CHART.top))

  const n = sessions.length
  const w = n ? (CHART.right - CHART.left) / n : 0
  const columns: ChartColumn[] = []
  const dots: ChartDot[] = []
  const gaps: ChartGapMark[] = []
  const medianPaths: string[] = []
  let run: string[] = []
  const endRun = () => {
    if (run.length > 1) medianPaths.push(`M${run.join('L')}`)
    run = []
  }

  sessions.forEach((s, i) => {
    const cx = r1(CHART.left + (i + 0.5) * w)
    // Attempts spread around the centre (12 apart in the design), squeezed to fit the column.
    const half = Math.max(0, Math.min(24, w / 2 - 8))
    const count = s.points.length
    const step = count > 1 ? Math.min(12, (2 * half) / (count - 1)) : 0
    s.points.forEach((p, j) => {
      const x = r1(cx + (j - (count - 1) / 2) * step)
      if (p.value === null) gaps.push({ attemptId: p.attemptId, x, y: CHART.gapY })
      else dots.push({ attemptId: p.attemptId, x, y: y(p.value), low: p.lowConfidence })
    })
    let tick: ChartColumn['tick'] = null
    if (s.median !== null) {
      const reach = Math.max(6, Math.min(32, w / 2 - 2))
      tick = { x1: r1(cx - reach), x2: r1(cx + reach), y: y(s.median) }
      run.push(`${cx} ${tick.y}`)
    } else endRun()
    columns.push({ sessionId: s.sessionId, cx, partial: isPartial(s), tick })
  })
  endRun()
  return { min, max, columns, dots, gaps, medianPaths }
}

// ---------- captions ----------

/** The insights sentence with its ISO days shown the way the rest of the screen shows dates. */
export function changeSentence(series: ProgressSeries, now: Date = new Date()): string {
  let text = series.change.text
  for (const m of [series.change.first, series.change.latest]) {
    if (m) text = text.split(m.date).join(formatDate(m.date, now))
  }
  return text
}

/** Why a point has no value, as a sentence. */
export function gapSentence(gap: Gap): string {
  if (gap.code === 'no_value' && gap.nullReason && gap.nullReason in NULL_REASON_TEXT) {
    return NULL_REASON_TEXT[gap.nullReason as NullReason]
  }
  return `${gapText(gap)}.`
}

/** The reason most of the missing points share. */
export function commonGapSentence(points: readonly ProgressPoint[]): string | null {
  const counts = new Map<string, number>()
  for (const p of points) {
    if (!p.gap) continue
    const text = gapSentence(p.gap)
    counts.set(text, (counts.get(text) ?? 0) + 1)
  }
  let best: string | null = null
  for (const [text, c] of counts) if (best === null || c > counts.get(best)!) best = text
  return best
}

export function panelSummary(series: ProgressSeries, now: Date = new Date()): string {
  if (series.state === 'not_applicable') return 'Not measured for this movement.'
  if (series.state === 'no_data') {
    const why = commonGapSentence(series.points)
    return why ? `No values yet. ${why}` : 'No values yet.'
  }
  if (series.state === 'needs_two_sessions') {
    const only = series.sessions.find((s) => s.median !== null)!
    return `Median ${only.medianText} on ${formatDate(only.date, now)}. ${changeSentence(series, now)}.`
  }
  // A session without a median stays in the list as a dash: a gap, not a skipped step.
  return `Medians ${series.sessions.map((s) => s.medianText).join(' → ')}. ${changeSentence(series, now)}.`
}

export function panelAria(series: ProgressSeries, phaseLabel: string | null, now: Date = new Date()): string {
  const head = phaseLabel ? `${series.info.label}, ${phaseLabel}.` : `${series.info.label}.`
  const medians = series.sessions
    .map((s) => `${formatDate(s.date, now)}: ${s.median === null ? 'no value' : s.medianText}`)
    .join(', ')
  const low = series.points.filter((p) => p.lowConfidence).length
  const missing = series.points.filter((p) => p.value === null).length
  const extra = [
    low ? `${low} low-confidence ${low === 1 ? 'value' : 'values'} not counted in the medians` : null,
    missing ? `${missing} ${missing === 1 ? 'attempt' : 'attempts'} without a value` : null,
  ].filter(Boolean)
  return [
    head,
    series.sessions.length ? `Session medians — ${medians}.` : 'No sessions.',
    extra.length ? `${extra.join('; ')}.` : null,
    series.state === 'ready' ? `${changeSentence(series, now)}.` : null,
    'Every value is in the sessions table.',
  ]
    .filter(Boolean)
    .join(' ')
}

// ---------- the screen ----------

export interface ProgressFilters {
  movement: MovementType
  /** Undefined = the view most sessions were filmed from. */
  cameraView?: CameraView
  from?: string
  to?: string
}

export interface MetricPanel {
  key: MetricKey
  series: ProgressSeries
  /** Phases the value is taken from, as stored with the measurements; null when no row says. */
  phaseLabel: string | null
  geometry: ChartGeometry
  maxLabel: string | null
  minLabel: string | null
  summary: string
  aria: string
}

export interface SessionColumn {
  sessionId: string
  date: string
  /** 'Nov 11' or 'Nov 11 · partial'. */
  label: string
  title: string | null
  partial: boolean
  attempts: number
  /** Attempts that have a metrics row. */
  processed: number
}

export interface ExcludedLine {
  sessionId: string
  /** 'Nov 4 · Front view'. */
  what: string
  reason: string
}

export interface ProgressView {
  movement: MovementType
  /** The one camera view on screen. */
  cameraView: CameraView | 'unknown' | null
  /** Views that sessions of this movement were filmed from (for the control). */
  views: CameraView[]
  sessions: SessionColumn[]
  panels: MetricPanel[]
  excluded: ExcludedLine[]
  /** '3 sessions · 12 attempts · Nov 11 has 2 of 5 processed'. */
  sessionsNote: string
  /** How many sessions of the movement exist before the view and date filters. */
  movementSessions: number
}

const VIEW_ORDER: CameraView[] = ['front', 'side', 'diagonal']

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

function axisLabel(key: MetricKey, v: number): string {
  // A round scale end reads as '10°' or '0.2', not '10.0°' or '0.20'.
  return `${Number(v.toPrecision(6))}${METRICS[key].unitShort}`
}

function phasesOf(rows: readonly AttemptMetricsRow[], movement: MovementType, key: MetricKey): string | null {
  for (const row of rows) {
    if (row.movement !== movement) continue
    const phases: Phase[] = readMetric(row, key).phases
    if (phases.length) return phases.map((p) => PHASE_LABELS[p] ?? p).join(' + ')
  }
  return null
}

export function buildProgress(
  sessions: readonly SessionSummary[],
  attempts: readonly AttemptView[],
  filters: ProgressFilters,
  now: Date = new Date(),
): ProgressView {
  const { movement } = filters
  const rows = attempts.flatMap((a) => (a.metrics ? [a.metrics] : []))
  const ofMovement = sessions.filter((s) => s.movement_type === movement)
  const views = VIEW_ORDER.filter((v) => ofMovement.some((s) => s.camera_view === v))

  const panels = metricsFor(movement).map((key): MetricPanel => {
    const series = progressSeries(sessions, attempts, rows, {
      movement,
      metric: key,
      cameraView: filters.cameraView,
      from: filters.from || undefined,
      to: filters.to || undefined,
    })
    const geometry = chartGeometry(series.sessions)
    const phaseLabel = phasesOf(rows, movement, key)
    return {
      key,
      series,
      phaseLabel,
      geometry,
      maxLabel: geometry.max === null ? null : axisLabel(key, geometry.max),
      minLabel: geometry.min === null ? null : geometry.min === 0 ? '0' : axisLabel(key, geometry.min),
      summary: panelSummary(series, now),
      aria: panelAria(series, phaseLabel, now),
    }
  })

  // Sessions, view and exclusions are the same for every metric of the movement.
  const first = panels[0]?.series
  const cols = (first?.sessions ?? []).map((s): SessionColumn => {
    const partial = isPartial(s)
    const processed = s.points.filter((p) => !isPending(p.gap)).length
    return {
      sessionId: s.sessionId,
      date: s.date,
      label: `${formatDate(s.date, now)}${partial ? ' · partial' : ''}`,
      title: s.title,
      partial,
      attempts: s.points.length,
      processed,
    }
  })
  const attemptCount = cols.reduce((n, c) => n + c.attempts, 0)
  const partialNotes = cols.filter((c) => c.partial).map((c) => `${formatDate(c.date, now)} has ${c.processed} of ${c.attempts} processed`)

  return {
    movement,
    cameraView: first?.cameraView ?? null,
    views,
    sessions: cols,
    panels,
    excluded: (first?.excluded ?? []).filter((e) => e.reason !== 'different_movement').map((e) => excludedLine(e, now)),
    sessionsNote: [plural(cols.length, 'session'), plural(attemptCount, 'attempt'), ...partialNotes].join(' · '),
    movementSessions: ofMovement.length,
  }
}

function excludedLine(e: ExcludedSession, now: Date): ExcludedLine {
  const parts = [e.date ? formatDate(e.date, now) : 'No date', e.cameraView ? VIEW_LABELS[e.cameraView] : null].filter(Boolean)
  return { sessionId: e.sessionId, what: parts.join(' · '), reason: exclusionText(e.reason) }
}

/** The movement to open on: the one practised most recently, else relevé balance. */
export function defaultMovement(sessions: readonly SessionSummary[]): MovementType {
  // `sessions` is newest first.
  return sessions[0]?.movement_type ?? 'releve_balance'
}

// ---------- the table (the chart's accessible equivalent) ----------

export interface TableValue {
  attemptId: string
  /** '6.8°' or '—'. */
  text: string
  /** 'low confidence, not counted' or the reason for a gap; null for a counted value. */
  note: string | null
}

export interface TableRow {
  sessionId: string
  dateLabel: string
  title: string | null
  values: TableValue[]
  counted: number
  medianText: string
}

export function tableRows(panel: MetricPanel, now: Date = new Date()): TableRow[] {
  return panel.series.sessions.map((s) => ({
    sessionId: s.sessionId,
    dateLabel: formatDate(s.date, now),
    title: s.title,
    values: s.points.map((p) => ({
      attemptId: p.attemptId,
      text: formatMetricWithUnit(panel.key, p.value),
      note: p.gap ? gapSentence(p.gap).replace(/\.$/, '') : p.lowConfidence ? 'Low confidence, not counted' : null,
    })),
    counted: s.countedValues,
    medianText: s.medianText,
  }))
}

export function movementLabel(movement: MovementType): string {
  return MOVEMENT_LABELS[movement]
}
