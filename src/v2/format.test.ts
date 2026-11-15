import { describe, expect, it } from 'vitest'
import type { AttemptMetricsRow } from '../data/schema'
import {
  differenceText,
  formatMetricWithUnit,
  formatNumber,
  formatTimecode,
  frameAt,
  metricsFor,
  NO_VALUE,
  phaseAt,
  readMetric,
} from './format'

describe('v2 format', () => {
  it('never turns a missing value into 0', () => {
    expect(formatNumber(null)).toBe(NO_VALUE)
    expect(formatNumber(undefined)).toBe(NO_VALUE)
    expect(formatNumber(Number.NaN)).toBe(NO_VALUE)
    expect(formatMetricWithUnit('balance_duration_s', null)).toBe(NO_VALUE)
    expect(formatNumber(0)).toBe('0.0')
    expect(formatNumber(-0.01)).toBe('0.0')
    expect(formatNumber(-2.14)).toBe('−2.1')
  })

  it('formats metrics with their units', () => {
    expect(formatMetricWithUnit('trunk_inclination_deg', 4.21)).toBe('4.2°')
    expect(formatMetricWithUnit('pelvis_ankle_offset_norm', 0.062)).toBe('0.06')
    expect(formatMetricWithUnit('balance_duration_s', 3.44)).toBe('3.4 s')
  })

  it('formats timecodes to hundredths', () => {
    expect(formatTimecode(3.48)).toBe('00:03.48')
    expect(formatTimecode(68.4)).toBe('01:08.40')
    expect(formatTimecode(null)).toBe('--:--.--')
  })

  it('words differences neutrally and has none across a gap', () => {
    expect(differenceText('trunk_inclination_deg', 4.2, 6.3, 'attempt 2')).toBe('2.1° lower than attempt 2')
    expect(differenceText('balance_duration_s', 3.4, 2.9, 'attempt 2')).toBe('0.5 s longer than attempt 2')
    expect(differenceText('pelvis_ankle_offset_norm', 0.06, 0.061, 'A')).toBe('Same as A')
    expect(differenceText('turn_count', null, 1, 'A')).toBeNull()
  })

  it('reads a metrics row, keeping null with its reason', () => {
    const row = {
      attempt_id: 'a',
      owner_id: 'u',
      movement: 'releve_balance',
      trunk_inclination_deg: 4.2,
      pelvis_ankle_offset_norm: null,
      balance_duration_s: null,
      knee_tracking_dev_deg: null,
      turn_count: null,
      phases: [],
      confidence: {
        trunk_inclination_deg: { level: 'high', score: 0.91, phases: ['hold'] },
        pelvis_ankle_offset_norm: { level: 'low', score: 0, phases: ['hold'], reason: 'no_leg_length' },
      },
      algorithm_version: 'x',
      computed_at: '2026-11-15T00:00:00Z',
    } as unknown as AttemptMetricsRow
    expect(readMetric(row, 'trunk_inclination_deg')).toMatchObject({ value: 4.2, confidence: 'high', phases: ['hold'], reason: null })
    const none = readMetric(row, 'pelvis_ankle_offset_norm')
    expect(none.value).toBeNull()
    expect(none.confidence).toBe('none')
    expect(none.reason).toMatch(/never tracked together/)
    expect(readMetric(null, 'turn_count').reason).toBe('Not processed yet.')
    expect(metricsFor('releve_balance')).not.toContain('turn_count')
    expect(metricsFor('pirouette')).toContain('turn_count')
  })

  it('looks up frames and phases by time', () => {
    const frames = [0, 1, 2].map((i) => ({ t: i / 30, image: null, world: null }))
    const series = { fps: 30, durationS: 0.1, width: 1, height: 1, model: 'm', smoothed: true, frames }
    expect(frameAt(series, 0.034)).toBe(frames[1])
    expect(frameAt(series, 9)).toBe(frames[2])
    expect(frameAt(null, 0)).toBeNull()
    const phases = [{ phase: 'hold' as const, start: 1, end: 2 }]
    expect(phaseAt(phases, 1.5)?.phase).toBe('hold')
    expect(phaseAt(phases, 2)).toBeNull()
  })
})
