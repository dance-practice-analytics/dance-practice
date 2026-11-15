// Synthetic rows for the page tests (Progress, Practice notes, Ask AI). Invented numbers
// only — no participant data.

import type { SessionSummary } from '../../../data/repo'
import type { AttemptMetricsRow, CameraView, MovementType } from '../../../data/schema'
import type { ConfidenceLevel, MetricKey, NullReason, Phase } from '../../../metrics/types'
import type { AttemptView } from '../../data'

const KEYS: MetricKey[] = ['trunk_inclination_deg', 'pelvis_ankle_offset_norm', 'balance_duration_s', 'knee_tracking_dev_deg', 'turn_count']

export function session(
  id: string,
  recorded_on: string,
  opts: { movement?: MovementType; view?: CameraView | null; title?: string | null } = {},
): SessionSummary {
  return {
    id,
    owner_id: 'u1',
    subject_id: null,
    movement_type: opts.movement ?? 'releve_balance',
    title: opts.title ?? null,
    recorded_on,
    camera_view: opts.view === undefined ? 'side' : opts.view,
    created_at: `${recorded_on}T15:00:00.000Z`,
    subject_code: 'S01',
    attempt_count: 0,
  }
}

export type MetricSpec = number | null | { value: number | null; level?: ConfidenceLevel; reason?: NullReason; phases?: Phase[] }

/** A metrics row; metrics left out are null with the reason 'no_valid_frames'. */
export function metricsRow(attemptId: string, movement: MovementType, values: Partial<Record<MetricKey, MetricSpec>>): AttemptMetricsRow {
  const row: Record<string, unknown> = {
    attempt_id: attemptId,
    owner_id: 'u1',
    movement,
    phases: [
      { phase: 'rise', start: 1, end: 1.8 },
      { phase: 'hold', start: 1.8, end: 5.2 },
    ],
    algorithm_version: 'test',
    computed_at: '2026-11-04T16:00:00.000Z',
  }
  const confidence: Record<string, unknown> = {}
  for (const key of KEYS) {
    const spec = values[key]
    const s = typeof spec === 'object' && spec !== null ? spec : { value: spec ?? null }
    row[key] = s.value
    if (key === 'turn_count' && movement !== 'pirouette') {
      confidence[key] = { level: 'low', score: 0, phases: [], reason: 'not_applicable' }
      continue
    }
    confidence[key] =
      s.value === null
        ? { level: 'low', score: 0, phases: s.phases ?? ['hold'], reason: s.reason ?? 'no_valid_frames' }
        : { level: s.level ?? 'high', score: 0.9, phases: s.phases ?? ['hold'] }
  }
  row.confidence = confidence
  return row as unknown as AttemptMetricsRow
}

/**
 * An attempt of a session. `values` undefined = not processed yet (no metrics row);
 * `minute` orders the attempts inside the session.
 */
export function attempt(
  id: string,
  s: SessionSummary,
  number: number,
  values?: Partial<Record<MetricKey, MetricSpec>>,
  status: AttemptView['status'] = values ? 'done' : 'queued',
): AttemptView {
  return {
    id,
    owner_id: 'u1',
    session_id: s.id,
    source: 'study_dataset',
    label: null,
    clip_name: null,
    video_path: null,
    video_sha256: null,
    duration_s: 8,
    fps: 30,
    status,
    error: null,
    created_at: `${s.recorded_on}T15:${String(number).padStart(2, '0')}:00.000Z`,
    session: s,
    metrics: values ? metricsRow(id, s.movement_type, values) : null,
    number,
  }
}
