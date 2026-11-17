// The sample session's data: synthetic, measured by the real engine, no video.

import { describe, expect, it } from 'vitest'
import { LANDMARK_COUNT } from '../pose/types'
import { buildSampleAttempts, isSampleAttempt, isSampleSession, SAMPLE_ATTEMPT_LABEL, SAMPLE_MODEL, SAMPLE_SESSION_TITLE } from './sample'

describe('sample session', () => {
  const attempts = buildSampleAttempts()

  it('has three relevé balance attempts with smoothed synthetic pose series', () => {
    expect(attempts).toHaveLength(3)
    for (const a of attempts) {
      expect(a.label).toBe(SAMPLE_ATTEMPT_LABEL)
      expect(a.clipName).toMatch(/synthetic/)
      expect(a.series.model).toBe(SAMPLE_MODEL)
      expect(a.series.smoothed).toBe(true)
      expect(a.series.frames.length).toBeGreaterThan(150)
      expect(a.metrics.movement).toBe('releve_balance')
    }
  })

  it('draws a picture skeleton inside the frame, and gaps stay gaps in both layers', () => {
    for (const a of attempts) {
      const tracked = a.series.frames.filter((f) => f.image)
      expect(tracked.length).toBeGreaterThan(a.series.frames.length * 0.9)
      for (const f of a.series.frames) {
        expect(f.image === null).toBe(f.world === null)
        if (!f.image) continue
        expect(f.image).toHaveLength(LANDMARK_COUNT)
        for (const p of f.image) {
          expect(p.x).toBeGreaterThan(0)
          expect(p.x).toBeLessThan(1)
          expect(p.y).toBeGreaterThan(0)
          expect(p.y).toBeLessThan(1)
        }
      }
    }
  })

  it('the engine finds the lift and measures every relevé metric', () => {
    for (const a of attempts) {
      const m = a.metrics
      expect(m.phases.map((p) => p.phase)).toEqual(expect.arrayContaining(['prep', 'rise', 'hold']))
      expect(m.trunk_inclination_deg).not.toBeNull()
      expect(m.pelvis_ankle_offset_norm).not.toBeNull()
      expect(m.balance_duration_s).not.toBeNull()
      expect(m.knee_tracking_dev_deg).not.toBeNull()
      expect(m.turn_count).toBeNull()
    }
  })

  it('attempts differ, so Compare has something to show', () => {
    const balance = attempts.map((a) => a.metrics.balance_duration_s)
    expect(new Set(balance).size).toBe(3)
  })

  it('is deterministic', () => {
    expect(buildSampleAttempts().map((a) => a.metrics)).toEqual(attempts.map((a) => a.metrics))
  })

  it('recognises sample rows by their markers', () => {
    expect(isSampleAttempt({ label: SAMPLE_ATTEMPT_LABEL })).toBe(true)
    expect(isSampleAttempt({ label: null })).toBe(false)
    expect(isSampleSession({ title: SAMPLE_SESSION_TITLE })).toBe(true)
    expect(isSampleSession({ title: 'Tuesday class' })).toBe(false)
  })
})
