import { describe, expect, it } from 'vitest'
import { compactGapReason, isCompactGap, NULL_REASON_TEXT, readMetric } from './format'
import type { AttemptMetricsRow } from '../data/schema'

describe('compact gap (metric applies but the clip had nothing to measure)', () => {
  it('is true for knee_not_bent, as a code or as its dancer-facing sentence', () => {
    expect(isCompactGap('knee_not_bent')).toBe(true)
    expect(isCompactGap(NULL_REASON_TEXT.knee_not_bent)).toBe(true)
    expect(compactGapReason(NULL_REASON_TEXT.knee_not_bent)).toBe('knee_not_bent')
  })

  it('keeps the full treatment for tracking problems and other reasons', () => {
    for (const r of ['no_valid_frames', 'no_pose', 'no_floor_reference', 'no_turn_detected', 'not_applicable'] as const) {
      expect(isCompactGap(r)).toBe(false)
      expect(isCompactGap(NULL_REASON_TEXT[r])).toBe(false)
    }
    expect(isCompactGap('Not available for this attempt.')).toBe(false)
    expect(isCompactGap(null)).toBe(false)
    expect(isCompactGap(undefined)).toBe(false)
    expect(isCompactGap('')).toBe(false)
  })

  it('matches the reason readMetric gives a knee-over-toes value of a clip without a plié', () => {
    const row = {
      knee_tracking_dev_deg: null,
      confidence: { knee_tracking_dev_deg: { reason: 'knee_not_bent' } },
    } as unknown as AttemptMetricsRow
    const r = readMetric(row, 'knee_tracking_dev_deg')
    expect(r.value).toBeNull()
    expect(isCompactGap(r.reason)).toBe(true)
  })
})
