// Synthetic rows for the view-model tests. Nothing here comes from a real recording.

import type { SessionSummary } from '../../../data/repo'
import type { AttemptMetricsRow, AttemptRow, ConfidenceLevel, PhaseSpan } from '../../../data/schema'
import type { FeedbackNote } from '../../../feedback/client'
import type { AttemptView } from '../../data'
import type { MetricKey } from '../../format'

const OWNER = 'owner-1'
const KEYS: MetricKey[] = ['trunk_inclination_deg', 'pelvis_ankle_offset_norm', 'balance_duration_s', 'knee_tracking_dev_deg', 'turn_count']

export function session(id: string, over: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id,
    owner_id: OWNER,
    subject_id: over.subject_code ? `sub-${over.subject_code}` : null,
    movement_type: 'releve_balance',
    title: null,
    recorded_on: null,
    camera_view: 'side',
    created_at: '2026-11-01T15:00:00Z',
    subject_code: null,
    attempt_count: 0,
    ...over,
  }
}

export type Values = Partial<Record<MetricKey, number | null>>

export const PHASES: PhaseSpan[] = [
  { phase: 'prep', start: 0, end: 1.2 },
  { phase: 'rise', start: 1.2, end: 2 },
  { phase: 'hold', start: 2, end: 5.4 },
  { phase: 'finish', start: 5.4, end: 6.4 },
  { phase: 'recovery', start: 6.4, end: 8.4 },
]

export function metrics(
  attemptId: string,
  values: Values,
  levels: Partial<Record<MetricKey, ConfidenceLevel>> = {},
  reason = 'no_valid_frames',
): AttemptMetricsRow {
  const confidence: Record<string, unknown> = {}
  for (const key of KEYS) {
    const v = values[key] ?? null
    confidence[key] = v === null ? { level: 'low', score: 0, reason } : { level: levels[key] ?? 'high', score: 0.9, phases: ['hold'] }
  }
  return {
    attempt_id: attemptId,
    owner_id: OWNER,
    movement: 'releve_balance',
    trunk_inclination_deg: null,
    pelvis_ankle_offset_norm: null,
    balance_duration_s: null,
    knee_tracking_dev_deg: null,
    turn_count: null,
    ...values,
    phases: PHASES,
    confidence: confidence as AttemptMetricsRow['confidence'],
    algorithm_version: 'test',
    computed_at: '2026-11-01T16:00:00Z',
  }
}

export function attempt(
  id: string,
  s: SessionSummary,
  number: number,
  over: Partial<AttemptRow> = {},
  m: AttemptMetricsRow | null = null,
): AttemptView {
  return {
    id,
    owner_id: OWNER,
    session_id: s.id,
    source: 'study_dataset',
    label: null,
    clip_name: `${id}.mp4`,
    video_path: null,
    video_sha256: null,
    duration_s: 8,
    fps: 30,
    status: 'done',
    error: null,
    created_at: `2026-11-01T15:0${number}:00Z`,
    ...over,
    session: s,
    metrics: m,
    number,
  }
}

export function note(id: string, attemptId: string, createdAt: string, metric: MetricKey = 'trunk_inclination_deg'): FeedbackNote {
  return {
    id,
    attemptId,
    model: 'test-model',
    promptVersion: 'v1',
    createdAt,
    response: {
      summary: 'Synthetic summary.',
      observations: [{ metric, observation: 'Synthetic observation.', suggestion: 'Synthetic suggestion.', confidence: 'high' }],
      cautions: [],
      disclaimer: 'Synthetic disclaimer.',
    },
  }
}

/** A session of `values.length` done attempts with one trunk value each (null = no value). */
export function trunkSession(id: string, over: Partial<SessionSummary>, values: (number | null)[]): { s: SessionSummary; a: AttemptView[] } {
  const s = session(id, over)
  const a = values.map((v, i) => attempt(`${id}-a${i + 1}`, s, i + 1, {}, metrics(`${id}-a${i + 1}`, { trunk_inclination_deg: v, balance_duration_s: v === null ? null : 3 })))
  return { s, a }
}
