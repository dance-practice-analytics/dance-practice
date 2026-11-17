// Synthetic rows for the page tests (Progress, Practice notes, Mika). Invented numbers
// only — no participant data.

import type { SessionSummary } from '../../../data/repo'
import type { AttemptMetricsRow, CameraView, MovementType } from '../../../data/schema'
import type { ConfidenceLevel, MetricKey, NullReason, Phase } from '../../../metrics/types'
import { THEME_KEYS, type PhraseEventOut, type PhraseNote, type PhraseNullReason, type PhraseResult, type ThemeKey } from '../../../metrics/phrase'
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
    note: null,
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

export type ThemeSpec = number | null | { value: number | null; level?: ConfidenceLevel; notes?: PhraseNote[]; reason?: PhraseNullReason }

/** A stored phrase result (attempt_metrics.phrase); themes left out are null with 'no_valid_frames'. */
export function phraseResult(themes: Partial<Record<ThemeKey, ThemeSpec>>, events: PhraseEventOut[] = [], anchor: number | null = null): PhraseResult {
  const out = {} as PhraseResult['themes']
  for (const key of THEME_KEYS) {
    const spec = themes[key]
    const s = typeof spec === 'object' && spec !== null ? spec : { value: spec ?? null }
    out[key] =
      s.value === null || s.value === undefined
        ? { value: null, parts: {}, confidence: { level: 'low', score: 0, reason: s.reason ?? 'no_valid_frames' } }
        : { value: s.value, parts: { secret_part: 'S07' }, confidence: { level: s.level ?? 'high', score: 0.9, ...(s.notes ? { notes: s.notes } : {}) } }
  }
  return {
    version: 'mt2-phrase-0.1.0',
    duration_s: 12.4,
    tracked_share: 0.97,
    label_doubt_share: 0,
    leg_length_m: 0.9,
    events,
    anchor,
    circles: [],
    themes: out,
  }
}

/** A processed phrase attempt (relevé columns null, not_applicable). */
export function phraseAttempt(id: string, s: SessionSummary, number: number, themes: Partial<Record<ThemeKey, ThemeSpec>>, events: PhraseEventOut[] = []): AttemptView {
  const a = attempt(id, s, number, {})
  const row = metricsRow(id, 'phrase', {}) as AttemptMetricsRow & Record<string, unknown>
  for (const key of KEYS) (row.confidence as Record<string, unknown>)[key] = { level: 'low', score: 0, phases: [], reason: 'not_applicable' }
  row.phrase = phraseResult(themes, events)
  return { ...a, metrics: row, status: 'done' }
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
    clip_number: null,
    note: null,
    video_path: null,
    video_sha256: null,
    duration_s: 8,
    fps: 30,
    status,
    error: null,
    is_reference: false,
    trim_start_s: null,
    trim_end_s: null,
    created_at: `${s.recorded_on}T15:${String(number).padStart(2, '0')}:00.000Z`,
    session: s,
    metrics: values ? metricsRow(id, s.movement_type, values) : null,
    number,
  }
}
