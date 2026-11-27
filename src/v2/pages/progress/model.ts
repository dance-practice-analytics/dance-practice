// View model of the Progress screen (FR-3.6.3, FR-3.6.4). Every number and sentence
// comes from src/insights/progress.ts; this file only picks the filters, lays the
// points out on the design's 300 × 120 chart and words the captions. Nothing grades.

import type { AttemptMetricsRow, CameraView, MovementType } from '../../../data/schema'
import {
  addDays,
  describeDifference,
  exclusionText,
  gapText,
  localDay,
  NO_DIFFERENCE_TEXT,
  progressSeries,
  sessionDay,
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
/** The enlarged chart (Expand): same marks, more room for ticks and attempt numbers. */
export const CHART_LARGE = { width: 640, height: 280, left: 56, right: 640, top: 14, bottom: 240, gapY: 127 } as const
export type ChartDims = { width: number; height: number; left: number; right: number; top: number; bottom: number; gapY: number }

/**
 * Mentor review, change 5. `y`: 'zero' starts the scale at 0 (below only for signed values);
 * 'fit' narrows it to the values so small changes are visible. `x`: one column per session
 * (attempts grouped) or one slot per attempt in order, sessions marked by separators.
 */
export interface ChartOptions {
  y?: 'zero' | 'fit'
  x?: 'sessions' | 'attempts'
}

export interface ChartDot {
  attemptId: string
  x: number
  y: number
  /** Low camera visibility (low confidence): hollow, dashed, not part of the median. */
  low: boolean
  value: number
  /** The attempt's label ('Attempt 2'), for the tooltip. */
  label: string
  /** 1-based position among the attempts on the chart (attempts axis). */
  order: number
}

export interface ChartGapMark {
  attemptId: string
  x: number
  y: number
  label: string
  order: number
}

export interface ChartColumn {
  sessionId: string
  /** Centre of the session's column. */
  cx: number
  /** Left and right edge of the session's column (its share of the x axis). */
  x1: number
  x2: number
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
  /** Gridline values from min to max (decimals allowed) with their y, and the step between them. */
  ticks: { v: number; y: number }[]
  step: number | null
  /** x of the lines between sessions (attempts axis only). */
  separators: number[]
  x: 'sessions' | 'attempts'
}

/** Smallest of 1, 2, 2.5, 5 × 10^k that is ≥ v: a round gridline step. */
export function niceStep(v: number): number {
  if (!(v > 0)) return 1
  const pow = 10 ** Math.floor(Math.log10(v))
  for (const m of [1, 2, 2.5, 5, 10]) if (m * pow >= v - pow * 1e-9) return Number((m * pow).toPrecision(12))
  return 10 * pow
}

/** Decimals a tick label needs so every tick of this step reads differently (2.5 → 1, 0.25 → 2). */
export function stepDecimals(step: number): number {
  for (let d = 0; d <= 6; d++) if (Math.abs(Math.round(step * 10 ** d) - step * 10 ** d) < 1e-6) return d
  return 6
}

/** The y range of a chart: from 0 (design default), or fitted to the values with round ends. */
export function yRange(values: readonly number[], mode: 'zero' | 'fit', ticks = 4): { min: number; max: number; step: number } | null {
  if (!values.length) return null
  const hi = Math.max(...values)
  const lo = Math.min(...values)
  if (mode === 'zero') {
    const max = niceCeil(Math.max(hi, 0))
    const min = lo < 0 ? -niceCeil(-lo) : 0
    return { min, max, step: niceStep((max - min) / ticks) }
  }
  if (hi === lo) {
    // One value (or all equal): a small window around it.
    const step = niceStep(Math.abs(hi) * 0.05 || 0.1)
    const c = Math.round(hi / step) * step
    return { min: Number((c - 2 * step).toPrecision(12)), max: Number((c + 2 * step).toPrecision(12)), step }
  }
  const step = niceStep((hi - lo) / ticks)
  const min = Number((Math.floor(lo / step + 1e-9) * step).toPrecision(12))
  let max = Number((Math.ceil(hi / step - 1e-9) * step).toPrecision(12))
  if (max <= min) max = min + step
  return { min, max, step }
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

export function chartGeometry(sessions: readonly ProgressSession[], options: ChartOptions = {}, dims: ChartDims = CHART): ChartGeometry {
  const xMode = options.x ?? 'sessions'
  const values = sessions.flatMap((s) => s.points).flatMap((p) => (p.value === null ? [] : [p.value]))
  // Default: the scale starts at 0 like the design; it only goes below for a signed value.
  const range = yRange(values, options.y ?? 'zero')
  const min = range?.min ?? null
  const max = range?.max ?? null
  const y = (v: number) => r1(dims.bottom - ((v - min!) / (max! - min!)) * (dims.bottom - dims.top))
  const ticks: ChartGeometry['ticks'] = []
  if (range) {
    const count = Math.round((range.max - range.min) / range.step)
    for (let k = 0; k <= count; k++) {
      const v = Number((range.min + k * range.step).toPrecision(12))
      ticks.push({ v, y: y(v) })
    }
  }

  const span = dims.right - dims.left
  const total = sessions.reduce((n, s) => n + s.points.length, 0)
  const columns: ChartColumn[] = []
  const dots: ChartDot[] = []
  const gaps: ChartGapMark[] = []
  const separators: number[] = []
  const medianPaths: string[] = []
  let run: string[] = []
  const endRun = () => {
    if (run.length > 1) medianPaths.push(`M${run.join('L')}`)
    run = []
  }

  let order = 0
  let slot = 0
  sessions.forEach((s, i) => {
    const count = s.points.length
    // Sessions axis: equal columns. Attempts axis: one equal slot per attempt, so a session's width follows its attempt count.
    const slotW = total ? span / total : 0
    const x1 = xMode === 'attempts' ? dims.left + slot * slotW : dims.left + (i * span) / sessions.length
    const x2 = xMode === 'attempts' ? dims.left + (slot + Math.max(count, 0)) * slotW : dims.left + ((i + 1) * span) / sessions.length
    const w = x2 - x1
    const cx = r1((x1 + x2) / 2)
    if (xMode === 'attempts' && i > 0) separators.push(r1(x1))
    // Sessions axis: attempts spread around the centre (12 apart in the design), squeezed to fit the column.
    const half = Math.max(0, Math.min(24 * (dims.width / CHART.width), w / 2 - 8))
    const step = count > 1 ? Math.min(12 * (dims.width / CHART.width), (2 * half) / (count - 1)) : 0
    s.points.forEach((p, j) => {
      order++
      const x = xMode === 'attempts' ? r1(x1 + (j + 0.5) * slotW) : r1(cx + (j - (count - 1) / 2) * step)
      if (p.value === null) gaps.push({ attemptId: p.attemptId, x, y: dims.gapY, label: p.label ?? `Attempt ${order}`, order })
      else dots.push({ attemptId: p.attemptId, x, y: y(p.value), low: p.lowConfidence, value: p.value, label: p.label ?? `Attempt ${order}`, order })
    })
    slot += count
    let tick: ChartColumn['tick'] = null
    if (s.median !== null) {
      const reach = xMode === 'attempts' ? Math.max(4, w / 2 - Math.min(6, w / 6)) : Math.max(6, Math.min(32 * (dims.width / CHART.width), w / 2 - 2))
      tick = { x1: r1(cx - reach), x2: r1(cx + reach), y: y(s.median) }
      run.push(`${cx} ${tick.y}`)
    } else endRun()
    columns.push({ sessionId: s.sessionId, cx, x1: r1(x1), x2: r1(x2), partial: isPartial(s), tick })
  })
  endRun()
  return { min, max, columns, dots, gaps, medianPaths, ticks, step: range?.step ?? null, separators, x: xMode }
}

// ---------- captions ----------

/** Session id → 'Session 3'. Sessions of one day share a date, so captions name them by number. */
export type SessionNames = ReadonlyMap<string, string>

/**
 * 'Session 1', 'Session 2'… for every session of the movement that has attempts, oldest
 * first in the charts' order (day, then creation time). The numbering ignores the camera
 * view and date filters, so a session keeps its name whatever is on screen.
 */
export function sessionNames(
  sessions: readonly SessionSummary[],
  attempts: readonly AttemptView[],
  movement: MovementType,
): Map<string, string> {
  const bySession = new Map<string, AttemptView[]>()
  for (const a of attempts) bySession.set(a.session_id, [...(bySession.get(a.session_id) ?? []), a])
  const dated = sessions.flatMap((s) => {
    const own = bySession.get(s.id)
    const date = s.movement_type === movement && own ? sessionDay(s, own) : null
    return date ? [{ s, date }] : []
  })
  dated.sort((a, b) => a.date.localeCompare(b.date) || a.s.created_at.localeCompare(b.s.created_at) || a.s.id.localeCompare(b.s.id))
  return new Map(dated.map((d, i) => [d.s.id, `Session ${i + 1}`]))
}

function nameOf(names: SessionNames, sessionId: string, date: string | null, now: Date): string {
  return names.get(sessionId) ?? formatDate(date, now)
}

/** The insights change, worded with session names: 'Session 3 is 1.9° less lean than Session 1'. */
export function changeSentence(series: ProgressSeries, names: SessionNames, now: Date = new Date()): string {
  const { first, latest, difference } = series.change
  if (series.change.state !== 'ready' || !first || !latest || difference === null) return series.change.text
  const a = nameOf(names, first.sessionId, first.date, now)
  const b = nameOf(names, latest.sessionId, latest.date, now)
  const size = describeDifference(series.metric, difference)
  return size === null ? `${NO_DIFFERENCE_TEXT} between ${a} and ${b}` : `${b} is ${size} than ${a}`
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

export function panelSummary(series: ProgressSeries, names: SessionNames, now: Date = new Date()): string {
  if (series.state === 'not_applicable') return 'Not measured for this movement.'
  if (series.state === 'no_data') {
    const why = commonGapSentence(series.points)
    return why ? `No values yet. ${why}` : 'No values yet.'
  }
  if (series.state === 'needs_two_sessions') {
    const only = series.sessions.find((s) => s.median !== null)!
    return `Median ${only.medianText} in ${nameOf(names, only.sessionId, only.date, now)} (${formatDate(only.date, now)}). ${changeSentence(series, names, now)}.`
  }
  // A session without a median stays in the list as a dash: a gap, not a skipped step.
  return `Medians ${series.sessions.map((s) => s.medianText).join(' → ')}. ${changeSentence(series, names, now)}.`
}

export function panelAria(series: ProgressSeries, phaseLabel: string | null, names: SessionNames, now: Date = new Date()): string {
  const head = phaseLabel ? `${series.info.label}, ${phaseLabel}.` : `${series.info.label}.`
  const medians = series.sessions
    .map((s) => `${nameOf(names, s.sessionId, s.date, now)} (${formatDate(s.date, now)}): ${s.median === null ? 'no value' : s.medianText}`)
    .join(', ')
  const low = series.points.filter((p) => p.lowConfidence).length
  const missing = series.points.filter((p) => p.value === null).length
  const extra = [
    low ? `${low} ${low === 1 ? 'value' : 'values'} with low camera visibility not counted in the medians` : null,
    missing ? `${missing} ${missing === 1 ? 'attempt' : 'attempts'} without a value` : null,
  ].filter(Boolean)
  return [
    head,
    series.sessions.length ? `Session medians — ${medians}.` : 'No sessions.',
    extra.length ? `${extra.join('; ')}.` : null,
    series.state === 'ready' ? `${changeSentence(series, names, now)}.` : null,
    'Every value is in the sessions table.',
  ]
    .filter(Boolean)
    .join(' ')
}

// ---------- the screen ----------

/** The date control: a fixed window ending today, everything, or the dancer's own days. */
export type DateRange = 'all' | 'last7' | 'last30' | 'custom'

export const DATE_RANGES: readonly { key: DateRange; label: string }[] = [
  { key: 'last7', label: 'Last 7 days' },
  { key: 'last30', label: 'Last 30 days' },
  { key: 'all', label: 'All' },
  { key: 'custom', label: 'Custom…' },
]

/** First and last day (inclusive, YYYY-MM-DD) of a date range; undefined = open on that side. */
export function dateBounds(
  range: DateRange,
  now: Date = new Date(),
  custom: { from?: string; to?: string } = {},
): { from?: string; to?: string } {
  if (range === 'all') return {}
  if (range === 'custom') return { from: custom.from || undefined, to: custom.to || undefined }
  const today = localDay(now)!
  // 'Last 7 days' is today and the six days before it.
  return { from: addDays(today, range === 'last7' ? -6 : -29), to: today }
}

export interface ProgressFilters {
  movement: MovementType
  /** Undefined = the view most sessions were filmed from. */
  cameraView?: CameraView
  /** Default 'custom' with `from`/`to`, so no range and no days means all sessions. */
  range?: DateRange
  /** Only used by the 'custom' range. */
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
  /** What the chart redraws from with other options (fit, attempts axis, enlarged). */
  data: readonly ProgressSession[]
  axis: ChartAxis
}

/** How stored values read on the axis: × scale, then the unit ('%' for a ratio shown as a percent). */
export interface ChartAxis {
  scale: number
  unit: string
  /** A value as on the rest of the screen, for tooltips. */
  valueText(v: number): string
}

/** A gridline label: as many decimals as the step needs ('2.5', '0.25'); the unit only where asked. */
export function tickLabel(axis: Pick<ChartAxis, 'scale' | 'unit'>, v: number, step: number, withUnit = false): string {
  const d = stepDecimals(Number((step * axis.scale).toPrecision(12)))
  // Rounded to the step's decimals, trailing zeros dropped: 0, 2.5, 5, 7.5, 10.
  const text = String(Number((v * axis.scale).toFixed(d)) || 0)
  return withUnit ? `${text}${axis.unit}` : text
}

export interface SessionColumn {
  sessionId: string
  date: string
  /** 'Session 3': sessions of one day share a date, so they are told apart by number. */
  name: string
  /** 'Nov 11', shown under the name. */
  dateLabel: string
  title: string | null
  partial: boolean
  attempts: number
  /** Attempts that have a metrics row. */
  processed: number
}

export interface ExcludedLine {
  sessionId: string
  /** 'Session 2 · Nov 4 · Front view'. */
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
  /** Names of every session of the movement, also those filtered out. */
  names: SessionNames
  panels: MetricPanel[]
  excluded: ExcludedLine[]
  /** '3 sessions · 12 attempts · Session 3 has 2 of 5 processed'. */
  sessionsNote: string
  /** How many sessions of the movement exist before the view and date filters. */
  movementSessions: number
}

const VIEW_ORDER: CameraView[] = ['front', 'side', 'diagonal']

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

function axisLabel(key: MetricKey, v: number): string {
  // A round scale end reads as '10°' or '0.2', not '10.0°' or '0.20'.
  return `${Number((v * METRICS[key].scale).toPrecision(6))}${METRICS[key].unitShort}`
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
  const names = sessionNames(sessions, attempts, movement)
  const bounds = dateBounds(filters.range ?? 'custom', now, filters)

  const panels = metricsFor(movement).map((key): MetricPanel => {
    const series = progressSeries(sessions, attempts, rows, {
      movement,
      metric: key,
      cameraView: filters.cameraView,
      from: bounds.from,
      to: bounds.to,
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
      summary: panelSummary(series, names, now),
      aria: panelAria(series, phaseLabel, names, now),
      data: series.sessions,
      axis: { scale: METRICS[key].scale, unit: METRICS[key].unitShort, valueText: (v) => formatMetricWithUnit(key, v) },
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
      name: nameOf(names, s.sessionId, s.date, now),
      dateLabel: formatDate(s.date, now),
      title: s.title,
      partial,
      attempts: s.points.length,
      processed,
    }
  })
  const attemptCount = cols.reduce((n, c) => n + c.attempts, 0)
  const partialNotes = cols.filter((c) => c.partial).map((c) => `${c.name} has ${c.processed} of ${c.attempts} processed`)

  return {
    movement,
    cameraView: first?.cameraView ?? null,
    views,
    sessions: cols,
    names,
    panels,
    excluded: (first?.excluded ?? []).filter((e) => e.reason !== 'different_movement').map((e) => excludedLine(e, names, now)),
    sessionsNote: [plural(cols.length, 'session'), plural(attemptCount, 'attempt'), ...partialNotes].join(' · '),
    movementSessions: ofMovement.length,
  }
}

function excludedLine(e: ExcludedSession, names: SessionNames, now: Date): ExcludedLine {
  const parts = [
    names.get(e.sessionId) ?? null,
    e.date ? formatDate(e.date, now) : 'No date',
    e.cameraView ? VIEW_LABELS[e.cameraView] : null,
  ].filter(Boolean)
  return { sessionId: e.sessionId, what: parts.join(' · '), reason: exclusionText(e.reason) }
}

/** The movement to open on: the one practised most recently, else phrase. */
export function defaultMovement(sessions: readonly SessionSummary[]): MovementType {
  // `sessions` is newest first.
  return sessions[0]?.movement_type ?? 'phrase'
}

// ---------- the table (the chart's accessible equivalent) ----------

export interface TableValue {
  attemptId: string
  /** '6.8°' or '—'. */
  text: string
  /** 'Low camera visibility, not counted' or the reason for a gap; null for a counted value. */
  note: string | null
}

export interface TableRow {
  sessionId: string
  /** 'Session 3', as under the charts. */
  name: string
  dateLabel: string
  title: string | null
  values: TableValue[]
  counted: number
  medianText: string
}

export function tableRows(panel: MetricPanel, names: SessionNames, now: Date = new Date()): TableRow[] {
  return panel.series.sessions.map((s) => ({
    sessionId: s.sessionId,
    name: nameOf(names, s.sessionId, s.date, now),
    dateLabel: formatDate(s.date, now),
    title: s.title,
    values: s.points.map((p) => ({
      attemptId: p.attemptId,
      text: formatMetricWithUnit(panel.key, p.value),
      note: p.gap ? gapSentence(p.gap).replace(/\.$/, '') : p.lowConfidence ? 'Low camera visibility, not counted' : null,
    })),
    counted: s.countedValues,
    medianText: s.medianText,
  }))
}

export function movementLabel(movement: MovementType): string {
  return MOVEMENT_LABELS[movement]
}
