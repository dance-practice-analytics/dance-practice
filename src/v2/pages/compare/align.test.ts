import { describe, expect, it } from 'vitest'
import type { PhaseSpan } from '../../../metrics/types'
import { alignmentText, buildTimeMap } from './align'
import { choosePair } from './pick'

const A: PhaseSpan[] = [
  { phase: 'prep', start: 0, end: 1.4 },
  { phase: 'rise', start: 1.4, end: 2.3 },
  { phase: 'hold', start: 2.3, end: 4.9 },
  { phase: 'finish', start: 4.9, end: 6.1 },
  { phase: 'recovery', start: 6.1, end: 8.1 },
]
const B: PhaseSpan[] = [
  { phase: 'prep', start: 0, end: 1.2 },
  { phase: 'rise', start: 1.2, end: 2.0 },
  { phase: 'hold', start: 2.0, end: 5.4 },
  { phase: 'finish', start: 5.4, end: 6.4 },
  { phase: 'recovery', start: 6.4, end: 8.4 },
]

describe('buildTimeMap — phase by phase', () => {
  const map = buildTimeMap({ duration: 8.1, phases: A }, { duration: 8.4, phases: B })

  it('starts and ends every shared phase together', () => {
    expect(map.mode).toBe('phases')
    expect(map.unavailable).toBeNull()
    expect(map.matched).toEqual(['prep', 'rise', 'hold', 'finish', 'recovery'])
    for (let i = 0; i < A.length; i++) {
      expect(map.toB(A[i].start)).toBeCloseTo(B[i].start, 9)
      expect(map.toB(A[i].end)).toBeCloseTo(B[i].end, 9)
    }
  })

  it('puts both attempts at the same share of a phase', () => {
    // Halfway through A's hold (2.3–4.9) is halfway through B's hold (2.0–5.4).
    expect(map.toB(3.6)).toBeCloseTo(3.7, 9)
    // A quarter into the rise.
    expect(map.toB(1.4 + 0.9 / 4)).toBeCloseTo(1.2 + 0.8 / 4, 9)
  })

  it('is its own inverse and never runs backwards', () => {
    let last = -1
    for (let t = 0; t <= 8.1; t += 0.05) {
      const tb = map.toB(t)
      expect(tb).toBeGreaterThanOrEqual(last)
      expect(map.toA(tb)).toBeCloseTo(t, 9)
      last = tb
    }
    expect(map.toB(-1)).toBe(0)
    expect(map.toB(99)).toBeCloseTo(8.4, 9)
  })

  it('reports how fast B runs against A inside a phase', () => {
    // B's hold is 3.4 s against A's 2.6 s.
    expect(map.slopeAt(3)).toBeCloseTo(3.4 / 2.6, 9)
    expect(map.slopeAt(0.5)).toBeCloseTo(1.2 / 1.4, 9)
  })
})

describe('buildTimeMap — partial and missing phases', () => {
  it('lines up only the phases both attempts have', () => {
    const map = buildTimeMap(
      { duration: 10, phases: [{ phase: 'rise', start: 2, end: 3 }, { phase: 'hold', start: 3, end: 6 }] },
      { duration: 12, phases: [{ phase: 'hold', start: 5, end: 7 }, { phase: 'finish', start: 7, end: 8 }] },
    )
    expect(map.mode).toBe('phases')
    expect(map.matched).toEqual(['hold'])
    expect(map.toB(3)).toBeCloseTo(5, 9)
    expect(map.toB(6)).toBeCloseTo(7, 9)
    // Before the first shared phase, time runs evenly from the clip start.
    expect(map.toB(1.5)).toBeCloseTo(2.5, 9)
    expect(map.toB(10)).toBeCloseTo(12, 9)
  })

  it('matches repeated phases by occurrence', () => {
    const map = buildTimeMap(
      { duration: 10, phases: [{ phase: 'hold', start: 1, end: 2 }, { phase: 'hold', start: 5, end: 6 }] },
      { duration: 10, phases: [{ phase: 'hold', start: 2, end: 3 }, { phase: 'hold', start: 7, end: 9 }] },
    )
    expect(map.toB(1)).toBeCloseTo(2, 9)
    expect(map.toB(5)).toBeCloseTo(7, 9)
    expect(map.toB(6)).toBeCloseTo(9, 9)
  })

  it('drops an anchor that would run a clip backwards', () => {
    const map = buildTimeMap(
      { duration: 10, phases: [{ phase: 'rise', start: 1, end: 2 }, { phase: 'hold', start: 4, end: 6 }] },
      // In B the hold comes before the rise: only one of them can be lined up.
      { duration: 10, phases: [{ phase: 'hold', start: 1, end: 2 }, { phase: 'rise', start: 4, end: 6 }] },
    )
    let last = -1
    for (let t = 0; t <= 10; t += 0.1) {
      expect(map.toB(t)).toBeGreaterThanOrEqual(last)
      last = map.toB(t)
    }
    expect(map.toB(10)).toBeCloseTo(10, 9)
  })

  it('falls back to share of clip length and says which attempt has no phases', () => {
    const none = buildTimeMap({ duration: 39, phases: [] }, { duration: 26, phases: [] })
    expect(none.mode).toBe('proportional')
    expect(none.unavailable).toBe('both_have_none')
    expect(none.toB(19.5)).toBeCloseTo(13, 9)
    expect(none.toA(13)).toBeCloseTo(19.5, 9)
    expect(none.slopeAt(5)).toBeCloseTo(26 / 39, 9)
    expect(alignmentText(none, 'phases')).toMatch(/No phases were found in either attempt.*share of clip length/)

    expect(buildTimeMap({ duration: 8, phases: A }, { duration: 8, phases: null }).unavailable).toBe('b_has_none')
    expect(buildTimeMap({ duration: 8, phases: undefined }, { duration: 8, phases: B }).unavailable).toBe('a_has_none')
    const apart = buildTimeMap({ duration: 8, phases: [{ phase: 'hold', start: 1, end: 2 }] }, { duration: 8, phases: [{ phase: 'turn', start: 1, end: 2 }] })
    expect(apart.unavailable).toBe('none_in_common')
    expect(alignmentText(apart, 'phases')).toMatch(/no phase in common/)
  })

  it('uses clip length when asked to, even with phases', () => {
    const map = buildTimeMap({ duration: 8.1, phases: A }, { duration: 8.4, phases: B }, 'proportional')
    expect(map.mode).toBe('proportional')
    expect(map.unavailable).toBeNull()
    expect(map.toB(4.05)).toBeCloseTo(4.2, 9)
    expect(alignmentText(map, 'proportional')).toBe('Matched by share of clip length: both clips start and end together.')
    expect(alignmentText(buildTimeMap({ duration: 8.1, phases: A }, { duration: 8.4, phases: B }), 'phases')).toMatch(/^Aligned phase by phase/)
  })

  it('survives clips without a duration', () => {
    const map = buildTimeMap({ duration: 0, phases: [] }, { duration: 0, phases: [] })
    expect(map.toB(3)).toBe(0)
    expect(map.toA(3)).toBe(0)
    expect(map.slopeAt(0)).toBe(1)
  })
})

describe('choosePair', () => {
  const at = (id: string, session_id: string, number: number, created_at: string) => ({ id, session_id, number, status: 'done', created_at })
  const all = [at('n1', 'new', 1, '2026-11-10T10:00:00Z'), at('n2', 'new', 2, '2026-11-10T10:01:00Z'), at('n3', 'new', 3, '2026-11-10T10:02:00Z'), at('o1', 'old', 1, '2026-11-01T10:00:00Z')]

  it('keeps a valid choice from the address', () => {
    expect(choosePair(all, 'n1', 'o1')).toEqual({ a: 'n1', b: 'o1' })
  })

  it('defaults to the latest processed attempt and its neighbour in the same session', () => {
    expect(choosePair(all)).toEqual({ a: 'n3', b: 'n2' })
    expect(choosePair(all, 'n1')).toEqual({ a: 'n1', b: 'n2' })
  })

  it('fills in A when only B is given, and never compares an attempt with itself', () => {
    expect(choosePair(all, undefined, 'n2')).toEqual({ a: 'n1', b: 'n2' })
    expect(choosePair(all, 'n2', 'n2')).toEqual({ a: 'n2', b: 'n1' })
  })

  it('ignores ids that are not processed attempts of this account and leaves B open when A is alone', () => {
    expect(choosePair(all, 'gone', 'also-gone')).toEqual({ a: 'n3', b: 'n2' })
    expect(choosePair(all, 'o1')).toEqual({ a: 'o1', b: null })
    expect(choosePair([])).toEqual({ a: null, b: null })
  })
})
