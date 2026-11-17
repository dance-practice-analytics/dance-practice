// Neutral formatting and the metric catalogue for every v2 screen. Nothing here
// grades: values, units and plain differences between two of the dancer's own attempts.

import type { AttemptMetricsRow, AttemptStatus, CameraView, MovementType } from '../data/schema'
import type { ConfidenceLevel, MetricKey, MetricNote, NullReason, Phase, PhaseSpan } from '../metrics/types'
import type { PoseFrame, PoseSeries } from '../pose/types'
import {
  formatValue,
  METRIC_CATALOG,
  METRIC_KEYS,
  metricsForMovement,
  NO_VALUE,
  roundValue,
  displayValue,
  type MetricInfo,
} from '../insights/catalog'

export type { ConfidenceLevel, MetricKey, NullReason, Phase, PhaseSpan }

// ---------- metric catalogue ----------
// One source: src/insights/catalog.ts (labels, units, decimals, rounding). This file
// only adds the short aliases the screens use.

export { NO_VALUE, displayValue }

export interface MetricDef extends MetricInfo {
  /** Words for a smaller / larger value in difference text (`lessWord` / `moreWord`). */
  less: string
  more: string
}

export const METRICS = Object.fromEntries(
  METRIC_KEYS.map((key) => [key, { ...METRIC_CATALOG[key], less: METRIC_CATALOG[key].lessWord, more: METRIC_CATALOG[key].moreWord }]),
) as Record<MetricKey, MetricDef>

export { METRIC_KEYS }

/** Metric keys that apply to a movement, in display order. */
export const metricsFor = metricsForMovement

// ---------- labels ----------

export const MOVEMENT_LABELS: Record<MovementType, string> = {
  releve_balance: 'Relevé balance',
  pirouette: 'Pirouette',
  phrase: 'Phrase',
}

/** Longer names where the movement is chosen (Import). */
export const MOVEMENT_CHOICE_LABELS: Record<MovementType, string> = {
  releve_balance: 'Relevé balance',
  pirouette: 'Pirouette',
  phrase: 'Phrase (contemporary combination)',
}

export const VIEW_LABELS: Record<CameraView, string> = {
  front: 'Front view',
  side: 'Side view',
  diagonal: 'Diagonal view',
}

export const PHASE_LABELS: Record<Phase, string> = {
  prep: 'Prep',
  rise: 'Rise',
  hold: 'Hold',
  turn: 'Turn',
  finish: 'Finish',
  recovery: 'Recovery',
}

export const STATUS_LABELS: Record<AttemptStatus | 'cancelled', string> = {
  queued: 'Queued',
  processing: 'Processing',
  done: 'Done',
  failed: 'Failed',
  cancelled: 'Cancelled',
}

/** How well the body was seen in the clip (tracking), never how well the dancer danced. */
export const CONFIDENCE_LABELS: Record<ConfidenceLevel | 'none', string> = {
  high: 'Clear view',
  medium: 'Partly hidden',
  low: 'Hard to see',
  none: 'Not seen',
}

/** Why a value is missing, in words for the dancer. Always about the recording, never the dancer. */
export const NULL_REASON_TEXT: Record<NullReason, string> = {
  no_pose: 'No person was found in this clip, so nothing was measured.',
  no_floor_reference: 'Heels and toes weren’t tracked in the first half second, so there is no floor level to measure from.',
  no_leg_length: 'Hip, knee and ankle were never tracked together, so distances can’t be scaled.',
  no_lift_detected: 'No heel lift was found in this clip, so the phases couldn’t be placed.',
  phase_not_found: 'This attempt has no frames in the phase this is measured in.',
  no_valid_frames: 'The landmarks this needs weren’t tracked during the phase.',
  knee_not_bent: 'Measured in plié only; the knee didn’t bend enough in this clip.',
  no_turn_detected: 'No turn was found in this clip.',
  not_applicable: 'Not measured for this movement.',
}

/**
 * Null reasons that mean "this clip had nothing to measure here" rather than a tracking
 * problem: the metric still applies but is shown as a slim quiet row (CompactGap), not a
 * full card with a big hatched box. Text after "<Metric> · not measured — ".
 */
export const COMPACT_GAP_TEXT: Partial<Record<NullReason, string>> = {
  knee_not_bent: 'no plié in this clip',
}

/**
 * The compact-gap reason for a null reason given as its code ('knee_not_bent') or as its
 * dancer-facing sentence from NULL_REASON_TEXT; null for every other reason.
 */
export function compactGapReason(reason: string | null | undefined): NullReason | null {
  if (!reason) return null
  for (const code of Object.keys(COMPACT_GAP_TEXT) as NullReason[]) {
    if (reason === code || reason === NULL_REASON_TEXT[code]) return code
  }
  return null
}

/** True when a missing value should render as a compact gap row instead of a full card. */
export function isCompactGap(reason: string | null | undefined): boolean {
  return compactGapReason(reason) !== null
}

export const METRIC_NOTE_TEXT: Record<MetricNote, string> = {
  left_right_swap_corrected: 'A left/right swap in the tracking was corrected.',
  tracking_lost_in_turn: 'Tracking was lost for part of the turn; rotation in that gap isn’t counted.',
}

// ---------- numbers ----------

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** Fixed decimals with a real minus sign; null/NaN → '—'. */
export function formatNumber(value: number | null | undefined, decimals = 1): string {
  if (!isNum(value)) return NO_VALUE
  const text = Math.abs(value).toFixed(decimals)
  // No "−0.0".
  return value < 0 && Number(text) !== 0 ? `−${text}` : text
}

/** Value text for a metric, without the unit (for a MetricCard); null → '—'. */
export function formatMetric(key: MetricKey, value: number | null | undefined): string {
  return isNum(value) ? displayValue(key, value).toFixed(METRICS[key].displayDecimals) : NO_VALUE
}

/** Value with its compact unit, e.g. '4.2°', '3.4 s', '0.06'; null → '—'. Same as insights `formatValue`. */
export const formatMetricWithUnit = formatValue

/** '8.4 s'; null → '—'. */
export function formatSeconds(seconds: number | null | undefined, decimals = 1): string {
  return isNum(seconds) ? `${formatNumber(seconds, decimals)} s` : NO_VALUE
}

/** Player timecode 'MM:SS.cc' (hundredths), e.g. '00:03.48'; null → '--:--.--'. */
export function formatTimecode(seconds: number | null | undefined): string {
  if (!isNum(seconds)) return '--:--.--'
  const cs = Math.max(0, Math.round(seconds * 100))
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(Math.floor(cs / 6000))}:${pad(Math.floor(cs / 100) % 60)}.${pad(cs % 100)}`
}

/** 'Nov 4' (or 'Nov 4, 2025' in another year) from YYYY-MM-DD or an ISO timestamp; null → '—'. */
export function formatDate(value: string | null | undefined, now: Date = new Date()): string {
  if (!value) return NO_VALUE
  // A date-only value is a calendar day, not midnight UTC.
  const d = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00`) : new Date(value)
  if (Number.isNaN(d.getTime())) return NO_VALUE
  const sameYear = d.getFullYear() === now.getFullYear()
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) })
}

/** 'Nov 4, 4:12 PM' from an ISO timestamp. */
export function formatDateTime(value: string | null | undefined): string {
  if (!value) return NO_VALUE
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return NO_VALUE
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

// ---------- greeting ----------

/**
 * The name the person chose in Settings, or null. The sign-up trigger fills
 * `profiles.display_name` with the email's local part, so that default counts as no name:
 * a greeting never shows anything derived from the email.
 */
export function chosenName(displayName: string | null | undefined, email: string | null | undefined): string | null {
  const name = displayName?.trim()
  if (!name) return null
  const local = email?.split('@')[0]?.trim().toLowerCase()
  return local && name.toLowerCase() === local ? null : name
}

/** 'Good morning, Ana' by local time (before 12 / before 18 / evening); without a name, just 'Good morning'. */
export function greeting(now: Date, name?: string | null): string {
  const h = now.getHours()
  const part = h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening'
  const first = name?.trim().split(/\s+/)[0]
  return first ? `Good ${part}, ${first}` : `Good ${part}`
}

/** '1.2 MB', '340 KB'. */
export function formatBytes(bytes: number | null | undefined): string {
  if (!isNum(bytes)) return NO_VALUE
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/**
 * Neutral difference between two of the dancer's own attempts, e.g.
 * '2.1° lower than attempt 2' or 'Same as attempt 2'. Null when either value is missing:
 * a gap has no difference.
 */
export function differenceText(
  key: MetricKey,
  value: number | null | undefined,
  other: number | null | undefined,
  otherLabel: string,
): string | null {
  if (!isNum(value) || !isNum(other)) return null
  const def = METRICS[key]
  // On the rounded values, so the text always agrees with the two numbers on screen.
  const diff = roundValue(key, roundValue(key, value) - roundValue(key, other))
  if (diff === 0) return `Same as ${otherLabel}`
  return `${formatValue(key, Math.abs(diff))} ${diff < 0 ? def.less : def.more} than ${otherLabel}`
}

// ---------- reading a metrics row ----------

export interface MetricReading {
  key: MetricKey
  def: MetricDef
  /** Null = not available; show `reason`, never 0. */
  value: number | null
  /** 'none' when there is no value. */
  confidence: ConfidenceLevel | 'none'
  score: number | null
  /** Phases the metric is taken from, e.g. ['hold']. */
  phases: Phase[]
  /** Dancer-facing sentence when the value is null. */
  reason: string | null
  /** Qualifiers on a computed value. */
  notes: string[]
}

interface StoredConfidence {
  level?: ConfidenceLevel
  score?: number
  phases?: Phase[]
  reason?: NullReason
  notes?: MetricNote[]
}

/** One metric of an `attempt_metrics` row, ready for a MetricCard or a table cell. */
export function readMetric(row: AttemptMetricsRow | null | undefined, key: MetricKey): MetricReading {
  const def = METRICS[key]
  if (!row) {
    return { key, def, value: null, confidence: 'none', score: null, phases: [], reason: 'Not processed yet.', notes: [] }
  }
  const raw = row[key]
  const value = isNum(raw) ? raw : null
  const conf = ((row.confidence ?? {}) as Record<string, StoredConfidence>)[key] ?? {}
  return {
    key,
    def,
    value,
    confidence: value === null ? 'none' : (conf.level ?? 'low'),
    score: isNum(conf.score) ? conf.score : null,
    phases: conf.phases ?? [],
    reason:
      value === null ? (conf.reason ? NULL_REASON_TEXT[conf.reason] : 'Not available for this attempt.') : null,
    notes: (conf.notes ?? []).map((n) => METRIC_NOTE_TEXT[n]),
  }
}

/** Every metric that applies to the row's movement. */
export function readMetrics(row: AttemptMetricsRow | null | undefined, movement: MovementType): MetricReading[] {
  return metricsFor(movement).map((key) => readMetric(row, key))
}

// ---------- pose series lookups ----------

/** The frame shown at time `t` (seconds), or null when the series is empty. */
export function frameAt(series: PoseSeries | null | undefined, t: number): PoseFrame | null {
  if (!series || series.frames.length === 0) return null
  if (series.trim) {
    // FR-3.2.7: a trimmed series starts later on the same frame grid; outside the
    // processed part there is no pose to show (a gap, never the nearest frame).
    const first = Math.round(series.frames[0].t * series.fps)
    const i = Math.floor(t * series.fps + 1e-6) - first
    return i >= 0 && i < series.frames.length ? series.frames[i] : null
  }
  const i = Math.min(series.frames.length - 1, Math.max(0, Math.floor(t * series.fps + 1e-6)))
  return series.frames[i]
}

/** The phase that contains `t`, or null between / outside phases. */
export function phaseAt(phases: PhaseSpan[] | null | undefined, t: number): PhaseSpan | null {
  return phases?.find((p) => t >= p.start && t < p.end) ?? null
}

/** How many frames have a detected pose. */
export function trackedFrames(series: PoseSeries): number {
  let n = 0
  for (const f of series.frames) if (f.image) n++
  return n
}
