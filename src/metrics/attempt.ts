// One entry point for the processing pipeline: the attempt's movement decides the engine.
// Relevé balance and pirouette go through computeMetrics (engine.ts); a phrase goes through
// computePhrase (phrase.ts) and stores the five relevé columns as null, reason
// `not_applicable`, so the two kinds of values are never mixed.

import type { PoseSeries } from '../pose/types'
import { computeMetrics, METRIC_PHASES } from './engine'
import { computePhrase, PHRASE_ALGORITHM_VERSION, type PhraseResult } from './phrase'
import type { AttemptMetrics, MetricConfidence, MetricKey, Movement } from './types'

export interface AttemptResult extends AttemptMetrics {
  /** Phrase attempts only; null for the other movements. */
  phrase: PhraseResult | null
}

export function computeAttempt(series: PoseSeries, movement: Movement): AttemptResult {
  if (movement !== 'phrase') return { ...computeMetrics(series, movement), phrase: null }
  const confidence = Object.fromEntries(
    (Object.keys(METRIC_PHASES) as MetricKey[]).map((k): [MetricKey, MetricConfidence] => [k, { level: 'low', score: 0, phases: [], reason: 'not_applicable' }]),
  ) as Record<MetricKey, MetricConfidence>
  return {
    movement,
    trunk_inclination_deg: null,
    pelvis_ankle_offset_norm: null,
    balance_duration_s: null,
    knee_tracking_dev_deg: null,
    turn_count: null,
    feet_angle_deg: null,
    phases: [],
    confidence,
    algorithm_version: PHRASE_ALGORITHM_VERSION,
    phrase: computePhrase(series),
  }
}
