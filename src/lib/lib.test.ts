import { describe, expect, it } from 'vitest'
import type { Attempt } from '../types'
import { boundaries, mapTime, withBoundary } from './attempts'
import { summarize, timeOnReleve } from './series'
import { suggestAttempts, validateAttempts } from './suggest'
import { exportCsv, exportRows } from './exportData'
import { describeChange, formatValue } from './format'
import { parse } from '../router'
import { assembleResults, buildPoseTrack, DEMO_SPEC, plannedAttempts } from '../mock/syntheticSession'
import { METRICS } from '../mock/metricsEngine'

const FPS = 30
const truth = plannedAttempts(DEMO_SPEC)
const track = buildPoseTrack(DEMO_SPEC)
const confirmed = assembleResults({ ...DEMO_SPEC, attempts: truth }, track)
const unconfirmed = assembleResults(DEMO_SPEC, track)

const attempt = (start: number, cuts: number[], end: number): Attempt => ({
  id: 'x',
  index: 1,
  start,
  end,
  phases: (['prep', 'rise', 'hold', 'release'] as const).map((id, i) => ({ id, label: id, start: cuts[i], end: cuts[i + 1] })),
  context: { view: 'front', music: false, fatigue: 'fresh' },
})

describe('mapTime', () => {
  const a = attempt(0, [1, 2, 3, 4, 5], 6)
  const b = attempt(10, [11, 13, 14, 18, 19], 20)

  it('maps phase boundaries onto phase boundaries', () => {
    boundaries(a).forEach((t, i) => expect(mapTime(t, a, b)).toBeCloseTo(boundaries(b)[i]))
  })

  it('interpolates within a phase, so a slow hold still lines up', () => {
    expect(mapTime(3.5, a, b)).toBeCloseTo(16) // halfway through hold
  })

  it('clamps times outside the attempt', () => {
    expect(mapTime(-5, a, b)).toBeCloseTo(b.start)
    expect(mapTime(99, a, b)).toBeCloseTo(b.end)
  })

  it('round-trips', () => {
    for (const t of [0.4, 1.7, 2.2, 3.9, 4.6, 5.8]) expect(mapTime(mapTime(t, a, b), b, a)).toBeCloseTo(t)
  })
})

describe('withBoundary', () => {
  const a = attempt(0, [1, 2, 3, 4, 5], 6)

  it('keeps phases contiguous when a phase start moves', () => {
    const m = withBoundary(a, 3, 2.5, 0, 10, FPS)
    expect(m.phases[1].end).toBe(m.phases[2].start)
    expect(m.phases[2].start).toBeCloseTo(2.5)
  })

  it('never crosses a neighbouring boundary', () => {
    const m = withBoundary(a, 2, 9, 0, 10, FPS)
    expect(m.phases[1].start).toBeLessThan(m.phases[2].start)
    expect(validateAttempts([m], 10)).toEqual([])
  })

  it('respects the outer limits and snaps to frames', () => {
    const m = withBoundary(a, 0, -3, 0.5, 10, FPS)
    expect(m.start).toBe(0.5)
    const n = withBoundary(a, 1, 1.0123, 0, 10, FPS)
    expect(Math.round(n.phases[0].start * FPS)).toBeCloseTo(n.phases[0].start * FPS, 6)
  })
})

describe('suggestAttempts', () => {
  const suggestions = suggestAttempts(unconfirmed)

  it('finds every attempt in the synthetic clip', () => {
    expect(suggestions).toHaveLength(truth.length)
  })

  // Onsets that start with zero slope (plié, heels starting down) read up to ~8 frames late.
  // That is why the dancer confirms every mark; the test guards against regressions past that.
  it('lands each phase boundary within 0.3 s of the truth', () => {
    suggestions.forEach(({ attempt: s }, i) => {
      s.phases.forEach((p, k) => {
        expect(Math.abs(p.start - truth[i].phases[k].start)).toBeLessThan(0.3)
        expect(Math.abs(p.end - truth[i].phases[k].end)).toBeLessThan(0.3)
      })
    })
  })

  it('bridges the tracking gap in attempt 4 instead of splitting it', () => {
    const hold = suggestions[3].attempt.phases[2]
    expect(hold.end - hold.start).toBeGreaterThan(1.5)
  })

  it('produces boundaries the server will accept', () => {
    expect(validateAttempts(suggestions.map((s) => s.attempt), unconfirmed.session.duration)).toEqual([])
  })

  it('works on varied sessions too', () => {
    for (const seed of [1014, 1021, 1024, ...Array.from({ length: 40 }, (_, i) => 2000 + i * 37)]) {
      const spec = { ...DEMO_SPEC, seed, variation: 1 }
      const r = assembleResults(spec, buildPoseTrack(spec))
      const got = suggestAttempts(r)
      const want = plannedAttempts(spec)
      expect(got).toHaveLength(want.length)
      got.forEach(({ attempt: s }, i) => expect(Math.abs(s.phases[2].start - want[i].phases[2].start)).toBeLessThan(0.3))
    }
  })
})

describe('validateAttempts', () => {
  it('flags overlap and clip limits', () => {
    const a = attempt(0, [1, 2, 3, 4, 5], 6)
    const b = { ...attempt(5.5, [6, 7, 8, 9, 10], 11), id: 'y', index: 2 }
    const problems = validateAttempts([a, b], 10.5).map((p) => p.message)
    expect(problems.some((m) => m.includes('overlaps attempt 2'))).toBe(true)
    expect(problems.some((m) => m.includes('runs past the clip'))).toBe(true)
  })

  it('flags phases that are not contiguous', () => {
    const a = attempt(0, [1, 2, 3, 4, 5], 6)
    a.phases[2] = { ...a.phases[2], start: 2.5 }
    expect(validateAttempts([a], 10)[0].message).toMatch(/doesn't start where/)
  })
})

describe('summarize', () => {
  const knee = METRICS.find((m) => m.id === 'kneeToe')!
  const shoulder = METRICS.find((m) => m.id === 'shoulderEar')!

  it('reports unavailable, with a reason, outside the metric’s phases', () => {
    const prep = confirmed.attempts[0].phases[0]
    const s = summarize(confirmed.series.shoulderEar, prep, shoulder, FPS)
    expect(s.available).toBe(false)
    expect(s.mean).toBeNull()
    expect(s.reason).toMatch(/Not measured/)
  })

  it('never invents a value where tracking was missing', () => {
    const hold = confirmed.attempts[3].phases[2]
    const s = summarize(confirmed.series.kneeToe, hold, knee, FPS)
    expect(s.coverage).toBeLessThan(1)
    if (!s.available) expect(s.reason).toMatch(/Tracking covered/)
  })

  it('time on relevé is unavailable across a tracking gap', () => {
    expect(timeOnReleve(confirmed.series.heelLift, confirmed.attempts[3], FPS)).toBeNull()
    expect(timeOnReleve(confirmed.series.heelLift, confirmed.attempts[0], FPS)).toBeGreaterThan(1)
  })
})

describe('export', () => {
  const rows = exportRows(confirmed)

  it('keeps missing values explicit with a flag and reason', () => {
    const missing = rows.filter((r) => r.quality_reason === 'no_pose_tracked')
    expect(missing.length).toBeGreaterThan(0)
    expect(missing.every((r) => r.value === null && !r.valid)).toBe(true)
  })

  it('writes an empty CSV cell for null, never a zero', () => {
    const line = exportCsv(confirmed).split('\n').find((l) => l.includes('no_pose_tracked'))!
    expect(line).toMatch(/,,false,no_pose_tracked$/)
  })
})

describe('format', () => {
  const knee = METRICS.find((m) => m.id === 'kneeToe')!
  it('describes change neutrally', () => {
    expect(describeChange(5, 3, knee)).toBe('2.0 pts lower')
    expect(describeChange(3, 3.01, knee)).toBe('about the same')
    expect(formatValue(null, knee)).toBe('—')
    expect(formatValue(-0.01, knee)).toBe('0.0 % shin')
  })
})

describe('router', () => {
  it('parses every screen', () => {
    expect(parse('')).toEqual({ name: 'journal' })
    expect(parse('#/signin')).toEqual({ name: 'signin' })
    expect(parse('#/new?study=on')).toEqual({ name: 'new' })
    expect(parse('#/sessions/s-1/confirm')).toEqual({ name: 'confirm', id: 's-1' })
    expect(parse('#/sessions/s%201')).toEqual({ name: 'workspace', id: 's 1' })
    expect(parse('#/nope')).toEqual({ name: 'notFound' })
  })
})
