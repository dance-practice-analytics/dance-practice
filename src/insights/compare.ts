// Difference table between two of the dancer's own attempts (FR-3.6.1, FR-3.6.2).
// Values and plain differences only: no grade, no direction that is "the right one".

import type { AttemptMetricsRow, AttemptRow, CameraView, ConfidenceLevel, MovementType, SessionRow } from '../data/schema'
import type { MetricKey } from '../metrics/types'
import { METRIC_CATALOG, METRIC_KEYS, formatDifference, formatValue, metricsForMovement, roundValue } from './catalog'
import type { MetricInfo } from './catalog'
import { readConfidence, readValue } from './util'

export interface AttemptInput {
  attempt: AttemptRow
  /** Null/undefined when the attempt has no `attempt_metrics` row yet. */
  metrics: AttemptMetricsRow | null | undefined
  /** Gives the camera view (and the movement when there are no metrics). */
  session?: SessionRow | null
}

export type Side = 'a' | 'b' | 'both'

export type NotComparedCode =
  /** The attempts are different movements. Applies to every metric. */
  | 'different_movement'
  /** Both camera views are known and they differ. Applies to every metric. */
  | 'different_camera_view'
  /** No metrics row on `side`. */
  | 'not_processed'
  /** The metric is null on `side`; `nullReason` carries the engine's reason when stored. */
  | 'no_value'
  /** Confidence level is 'low' on `side`. */
  | 'low_confidence'

export interface NotCompared {
  code: NotComparedCode
  side?: Side
  nullReason?: { a?: string; b?: string }
}

export interface MetricSide {
  /** Stored value; null = not available, never 0. */
  value: number | null
  /** Value at the metric's decimals, as shown. */
  rounded: number | null
  /** '4.2°' or '—'. */
  text: string
  /** Null when there is no value. */
  confidence: ConfidenceLevel | null
  score: number | null
  nullReason: string | null
}

export type Direction = 'less' | 'more' | 'same'

export interface MetricComparison {
  metric: MetricKey
  info: MetricInfo
  a: MetricSide
  b: MetricSide
  comparable: boolean
  /** Set exactly when `comparable` is false. */
  reason: NotCompared | null
  /** b − a of the rounded values, at the metric's decimals; null when not comparable. */
  difference: number | null
  /** '−2.1°', '+0.4 s', '0.0°' or '—'. */
  differenceText: string
  direction: Direction | null
  /** 'B is 2.1° lower', 'No difference at this precision', 'Not compared: …'. */
  sentence: string
}

export interface AttemptComparison {
  /** The shared movement; null when the two differ or neither is known. */
  movement: MovementType | null
  cameraViews: { a: CameraView | null; b: CameraView | null }
  /** False when a reason applies to the whole pair (movement or camera view). */
  comparable: boolean
  reason: NotCompared | null
  rows: MetricComparison[]
}

export interface PairLabels {
  a: string
  b: string
}

export const DEFAULT_LABELS: PairLabels = { a: 'A', b: 'B' }

export const NO_DIFFERENCE_TEXT = 'No difference at this precision'

/** Size and direction of a difference, e.g. '2.1° lower'. Null for a zero difference. */
export function describeDifference(metric: MetricKey, difference: number): string | null {
  const info = METRIC_CATALOG[metric]
  const d = roundValue(metric, difference)
  if (d === 0) return null
  return `${formatValue(metric, Math.abs(d))} ${d < 0 ? info.lessWord : info.moreWord}`
}

/** 'B is 2.1° lower' or 'No difference at this precision'. `difference` is b − a. */
export function differenceSentence(metric: MetricKey, difference: number, labels: PairLabels = DEFAULT_LABELS): string {
  const text = describeDifference(metric, difference)
  return text === null ? NO_DIFFERENCE_TEXT : `${labels.b} is ${text}`
}

/** 'Not compared: tracking was low in B'. About the recording, never the dancer. */
export function notComparedSentence(reason: NotCompared, labels: PairLabels = DEFAULT_LABELS): string {
  const one = reason.side === 'a' ? labels.a : labels.b
  const both = reason.side === 'both'
  switch (reason.code) {
    case 'different_movement':
      return 'Not compared: the two attempts are different movements'
    case 'different_camera_view':
      return 'Not compared: the two attempts were filmed from different camera views'
    case 'not_processed':
      return both ? `Not compared: ${labels.a} and ${labels.b} have no measurements yet` : `Not compared: ${one} has no measurements yet`
    case 'no_value':
      return both ? `Not compared: no value in ${labels.a} or ${labels.b}` : `Not compared: no value in ${one}`
    case 'low_confidence':
      return both ? `Not compared: tracking was low in ${labels.a} and ${labels.b}` : `Not compared: tracking was low in ${one}`
  }
}

function readSide(input: AttemptInput, metric: MetricKey): MetricSide {
  const row = input.metrics ?? null
  const value = readValue(row, metric)
  const conf = row ? readConfidence(row, metric) : { level: null, score: null, nullReason: null }
  return {
    value,
    rounded: value === null ? null : roundValue(metric, value),
    text: formatValue(metric, value),
    confidence: conf.level,
    score: conf.score,
    nullReason: conf.nullReason,
  }
}

function sideOf(a: boolean, b: boolean): Side | null {
  return a && b ? 'both' : a ? 'a' : b ? 'b' : null
}

function metricReason(a: AttemptInput, b: AttemptInput, sa: MetricSide, sb: MetricSide): NotCompared | null {
  const unprocessed = sideOf(!a.metrics, !b.metrics)
  if (unprocessed) return { code: 'not_processed', side: unprocessed }
  const missing = sideOf(sa.value === null, sb.value === null)
  if (missing) {
    const nullReason: { a?: string; b?: string } = {}
    if (sa.value === null && sa.nullReason) nullReason.a = sa.nullReason
    if (sb.value === null && sb.nullReason) nullReason.b = sb.nullReason
    return { code: 'no_value', side: missing, nullReason }
  }
  const low = sideOf(sa.confidence === 'low', sb.confidence === 'low')
  if (low) return { code: 'low_confidence', side: low }
  return null
}

const movementOf = (x: AttemptInput): MovementType | null => x.metrics?.movement ?? x.session?.movement_type ?? null

/**
 * Compare attempt B against attempt A, metric by metric. A pair is comparable when both
 * attempts are the same movement, their camera views match (or at least one is unknown),
 * both values exist and neither has low tracking confidence.
 */
export function compareAttempts(a: AttemptInput, b: AttemptInput, labels: PairLabels = DEFAULT_LABELS): AttemptComparison {
  const ma = movementOf(a)
  const mb = movementOf(b)
  const va = a.session?.camera_view ?? null
  const vb = b.session?.camera_view ?? null

  let pairReason: NotCompared | null = null
  if (ma && mb && ma !== mb) pairReason = { code: 'different_movement' }
  else if (va && vb && va !== vb) pairReason = { code: 'different_camera_view' }

  const movement = pairReason?.code === 'different_movement' ? null : (ma ?? mb)
  const keys = movement ? metricsForMovement(movement) : METRIC_KEYS

  const rows = keys.map((metric): MetricComparison => {
    const sa = readSide(a, metric)
    const sb = readSide(b, metric)
    const reason = pairReason ?? metricReason(a, b, sa, sb)
    const base = { metric, info: METRIC_CATALOG[metric], a: sa, b: sb }
    if (reason) {
      return { ...base, comparable: false, reason, difference: null, differenceText: formatDifference(metric, null), direction: null, sentence: notComparedSentence(reason, labels) }
    }
    const difference = roundValue(metric, sb.rounded! - sa.rounded!)
    return {
      ...base,
      comparable: true,
      reason: null,
      difference,
      differenceText: formatDifference(metric, difference),
      direction: difference === 0 ? 'same' : difference < 0 ? 'less' : 'more',
      sentence: differenceSentence(metric, difference, labels),
    }
  })

  return { movement, cameraViews: { a: va, b: vb }, comparable: pairReason === null, reason: pairReason, rows }
}
