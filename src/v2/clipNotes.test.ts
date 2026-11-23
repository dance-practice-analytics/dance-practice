import { describe, expect, it } from 'vitest'
import type { AttemptMetricsRow } from '../data/schema'
import { CLIP_NOTE_FALLBACK, CLIP_NOTE_TEXT, clipNotesOf } from './format'

const row = (confidence: Record<string, unknown>): AttemptMetricsRow =>
  ({
    attempt_id: 'a1',
    owner_id: 'u1',
    movement: 'releve_balance',
    trunk_inclination_deg: 4.2,
    pelvis_ankle_offset_norm: 0.1,
    balance_duration_s: 2.4,
    knee_tracking_dev_deg: null,
    turn_count: null,
    phases: [],
    confidence: confidence as AttemptMetricsRow['confidence'],
    algorithm_version: 'mt2-metrics-1.2.0',
    computed_at: '2026-11-20T10:00:00Z',
  }) as AttemptMetricsRow

describe('clip notes (attempt_metrics.confidence[*].clip_notes)', () => {
  it('shows nothing when the engine left no clip remark', () => {
    expect(clipNotesOf(null)).toEqual([])
    expect(clipNotesOf(undefined)).toEqual([])
    expect(clipNotesOf(row({}))).toEqual([])
    expect(clipNotesOf(row({ trunk_inclination_deg: { level: 'high', score: 0.9 } }))).toEqual([])
  })

  it('says once that only the first of several attempts was measured', () => {
    const note = ['multiple_lifts_detected']
    const r = row({
      trunk_inclination_deg: { level: 'high', score: 0.9, clip_notes: note },
      pelvis_ankle_offset_norm: { level: 'medium', score: 0.7, clip_notes: note },
      balance_duration_s: { level: 'high', score: 0.9, clip_notes: note },
      knee_tracking_dev_deg: { reason: 'knee_not_bent' },
    })
    expect(clipNotesOf(r)).toEqual([CLIP_NOTE_TEXT.multiple_lifts_detected])
    expect(CLIP_NOTE_TEXT.multiple_lifts_detected).toBe(
      'This clip seems to hold more than one attempt; only the first one was measured.',
    )
  })

  it('falls back to a generic sentence for a code it does not know, once', () => {
    const r = row({
      trunk_inclination_deg: { level: 'high', score: 0.9, clip_notes: ['camera_moved', 'lighting_changed'] },
      balance_duration_s: { level: 'high', score: 0.9, clip_notes: ['multiple_lifts_detected'] },
    })
    expect(clipNotesOf(r)).toEqual([CLIP_NOTE_FALLBACK, CLIP_NOTE_TEXT.multiple_lifts_detected])
  })

  it('ignores malformed stored values', () => {
    const r = row({
      trunk_inclination_deg: { clip_notes: 'multiple_lifts_detected' },
      balance_duration_s: { clip_notes: [42, null, ''] },
      knee_tracking_dev_deg: null,
    })
    expect(clipNotesOf(r)).toEqual([])
  })

  it('keeps the copy neutral: no grades or verdicts', () => {
    const words = /\b(good|bad|better|worse|correct|incorrect|wrong|error|fail|score|perfect)\b/i
    for (const text of [...Object.values(CLIP_NOTE_TEXT), CLIP_NOTE_FALLBACK]) expect(text).not.toMatch(words)
  })
})
