// Builds the only thing that is sent to the model (FR-3.7.2, NFR-1/2): metric id, value,
// unit, phases and confidence, plus the same values of earlier attempts of the session.
// No ids, labels, file names, subject codes, keypoints or free text ever enter it: every
// string comes from an allowlist and every number is checked, because attempt_metrics
// rows are written by the client.

// @ts-ignore TS5097: Deno needs the .ts extension
import { CONFIDENCE_LEVELS, METRIC_KEYS, type ConfidenceLevel, type MetricKey } from './contract.ts'

export const MOVEMENTS = ['releve_balance', 'pirouette'] as const
export type Movement = (typeof MOVEMENTS)[number]

export const PHASES = ['prep', 'rise', 'hold', 'turn', 'finish', 'recovery'] as const
export type Phase = (typeof PHASES)[number]

/** Why a value is null (src/metrics/types.ts NullReason) plus 'unknown' when the row gives none. */
export const NULL_REASONS = [
  'no_pose',
  'no_floor_reference',
  'no_leg_length',
  'no_lift_detected',
  'phase_not_found',
  'no_valid_frames',
  'knee_not_bent',
  'no_turn_detected',
  'not_applicable',
  'unknown',
] as const
export type NullReason = (typeof NULL_REASONS)[number]

export const METRIC_NOTES = ['left_right_swap_corrected', 'tracking_lost_in_turn'] as const
export type MetricNote = (typeof METRIC_NOTES)[number]

export const METRIC_UNITS: Record<MetricKey, string> = {
  trunk_inclination_deg: 'degrees',
  pelvis_ankle_offset_norm: 'ratio of leg length',
  balance_duration_s: 'seconds',
  knee_tracking_dev_deg: 'degrees',
  turn_count: 'turns',
}

const DECIMALS: Record<MetricKey, number> = {
  trunk_inclination_deg: 1,
  pelvis_ankle_offset_norm: 3,
  balance_duration_s: 2,
  knee_tracking_dev_deg: 1,
  turn_count: 2,
}

/** How many earlier attempts of the same session are sent for comparison. */
export const MAX_EARLIER_ATTEMPTS = 3

/** The columns of attempt_metrics the function reads. jsonb columns are untrusted. */
export interface MetricsRowLike {
  movement: string
  trunk_inclination_deg: number | null
  pelvis_ankle_offset_norm: number | null
  balance_duration_s: number | null
  knee_tracking_dev_deg: number | null
  turn_count: number | null
  phases: unknown
  confidence: unknown
}

export interface PayloadMetric {
  metric: MetricKey
  unit: string
  /** null = not measured; never zero-filled. */
  value: number | null
  /** Phases of the movement the value is taken from. */
  phases: Phase[]
  confidence: ConfidenceLevel
  /** Present exactly when value is null. */
  not_measured_reason?: NullReason
  notes?: MetricNote[]
}

export interface PayloadEarlierAttempt {
  /** 1 = the attempt right before this one in the same session. */
  attempts_before: number
  metrics: { metric: MetricKey; value: number | null; confidence: ConfidenceLevel }[]
}

export interface FeedbackPayload {
  movement: Movement
  metrics: PayloadMetric[]
  phases: { phase: Phase; duration_s: number }[]
  earlier_attempts: PayloadEarlierAttempt[]
}

const round = (v: number, decimals: number) => {
  const f = 10 ** decimals
  return Math.round(v * f) / f
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

function allowed<T extends string>(list: readonly T[], v: unknown): v is T {
  return typeof v === 'string' && (list as readonly string[]).includes(v)
}

export function isMovement(v: unknown): v is Movement {
  return allowed(MOVEMENTS, v)
}

function metricValue(row: MetricsRowLike, key: MetricKey): number | null {
  const v = row[key]
  return typeof v === 'number' && Number.isFinite(v) ? round(v, DECIMALS[key]) : null
}

function metricEntry(row: MetricsRowLike, key: MetricKey): PayloadMetric | null {
  const conf = isRecord(row.confidence) && isRecord(row.confidence[key]) ? (row.confidence[key] as Record<string, unknown>) : {}
  const reason = allowed(NULL_REASONS, conf.reason) ? conf.reason : undefined
  // Turn count does not exist for a relevé balance; it is left out instead of reported as missing.
  if (reason === 'not_applicable' || (key === 'turn_count' && row.movement !== 'pirouette')) return null

  const value = metricValue(row, key)
  const entry: PayloadMetric = {
    metric: key,
    unit: METRIC_UNITS[key],
    value,
    phases: Array.isArray(conf.phases) ? conf.phases.filter((p): p is Phase => allowed(PHASES, p)) : [],
    // A missing or malformed confidence is treated as low, so the value is never interpreted.
    confidence: allowed(CONFIDENCE_LEVELS, conf.level) ? conf.level : 'low',
  }
  if (value === null) entry.not_measured_reason = reason ?? 'unknown'
  const notes = Array.isArray(conf.notes) ? conf.notes.filter((n): n is MetricNote => allowed(METRIC_NOTES, n)) : []
  if (notes.length > 0) entry.notes = notes
  return entry
}

function phaseDurations(phases: unknown): FeedbackPayload['phases'] {
  if (!Array.isArray(phases)) return []
  const out: FeedbackPayload['phases'] = []
  for (const p of phases) {
    if (!isRecord(p) || !allowed(PHASES, p.phase)) continue
    const { start, end } = p
    if (typeof start !== 'number' || typeof end !== 'number' || !Number.isFinite(start) || !Number.isFinite(end) || end < start) continue
    out.push({ phase: p.phase, duration_s: round(end - start, 2) })
  }
  return out
}

/**
 * `row` is the attempt the notes are about. `earlier` are attempts of the same session
 * recorded before it, newest first; rows of another movement are ignored.
 * Throws when the movement is not one the app knows.
 */
export function buildPayload(row: MetricsRowLike, earlier: MetricsRowLike[] = []): FeedbackPayload {
  if (!isMovement(row.movement)) throw new Error('unknown movement')
  const metrics = METRIC_KEYS.map((k) => metricEntry(row, k)).filter((m): m is PayloadMetric => m !== null)
  const keys = metrics.map((m) => m.metric)
  const earlier_attempts = earlier
    .filter((e) => e.movement === row.movement)
    .slice(0, MAX_EARLIER_ATTEMPTS)
    .map((e, i) => ({
      attempts_before: i + 1,
      metrics: keys.map((k) => {
        const m = metricEntry(e, k)
        return { metric: k, value: m?.value ?? null, confidence: m?.confidence ?? 'low' }
      }),
    }))
  return { movement: row.movement, metrics, phases: phaseDurations(row.phases), earlier_attempts }
}

/** False when no metric has a value: there is nothing to describe, so the model is not called. */
export function hasMeasurements(payload: FeedbackPayload): boolean {
  return payload.metrics.some((m) => m.value !== null)
}
