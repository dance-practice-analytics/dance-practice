// Phrase engine (phrase.ts), its pipeline entry (attempt.ts) and event alignment
// (phraseAlign.ts) on the synthetic phrase dancer. Every number is made up: no footage,
// no participant data.

import { describe, expect, it } from 'vitest'
import type { PoseSeries } from '../pose/types'
import { computeAttempt } from './attempt'
import { ALGORITHM_VERSION, computeMetrics } from './engine'
import { computePhrase, DEPTH_LIMITED, isPhraseResult, PHRASE_ALGORITHM_VERSION, THEME_KEYS, type PhraseResult } from './phrase'
import { alignPhrases, similarity } from './phraseAlign'
import { bump, phraseSeries, STAND, type PhrasePose } from './testing/phraseDancer'

const at = (over: Partial<PhrasePose>): PhrasePose => ({ ...STAND, ...over })

/**
 * A small phrase, shifted by `delay` seconds and stretched by `tempo` (> 1 = slower):
 * plié with the knees 10° inside, a right leg to the side, a forward fold with the head
 * curled, a full right-arm circle, a left leg back, a turn.
 */
function phrase(delay = 0, tempo = 1, extra: Partial<PhrasePose> = {}) {
  const T = (t: number) => (t - delay) / tempo
  return (t0: number): PhrasePose => {
    const t = T(t0)
    if (t >= 1 && t < 2.2) return at({ ...extra, plieDeg: 60 * bump(t, 1, 2.2, 0.3), turnoutDeg: 30, kneeDevDeg: 10 })
    if (t >= 2.6 && t < 4) return at({ ...extra, gesture: { side: 'right', elevDeg: 90 * bump(t, 2.6, 4, 0.4), azDeg: 90 } })
    if (t >= 4.4 && t < 6) return at({ ...extra, trunkDeg: 85 * bump(t, 4.4, 6, 0.4), headFlexDeg: 40 * bump(t, 4.4, 6, 0.4) })
    if (t >= 6.4 && t < 8.4) {
      const a = (-90 + 360 * Math.min(1, Math.max(0, (t - 6.5) / 1.8))) * (Math.PI / 180)
      return at({ ...extra, arms: { left: { dir: [0, 0.2, -1] }, right: { dir: [0, Math.cos(a), Math.sin(a)] } } })
    }
    if (t >= 8.8 && t < 10.3) return at({ ...extra, gesture: { side: 'left', elevDeg: 70 * bump(t, 8.8, 10.3, 0.4), azDeg: 180, kneeDeg: 40 } })
    if (t >= 10.8 && t < 11.8) return at({ ...extra, yawDeg: 360 * Math.min(1, (t - 10.8) / 0.8) })
    return at(extra)
  }
}

/** The tracker's left/right mislabel: every left landmark exchanged with its right twin. */
function swapLabels(s: PoseSeries): PoseSeries {
  const pairs = [
    [1, 4], [2, 5], [3, 6], [7, 8], [9, 10], [11, 12], [13, 14], [15, 16], [17, 18], [19, 20], [21, 22],
    [23, 24], [25, 26], [27, 28], [29, 30], [31, 32],
  ]
  const swap = (lm: PoseSeries['frames'][number]['world']) => {
    if (!lm) return lm
    const out = lm.map((p) => ({ ...p }))
    for (const [a, b] of pairs) [out[a], out[b]] = [out[b], out[a]]
    return out
  }
  return { ...s, frames: s.frames.map((f) => ({ ...f, world: swap(f.world), image: swap(f.image) })) }
}

describe('computePhrase', () => {
  const result = computePhrase(phraseSeries(phrase(), 13))

  it('is versioned, lists the events and picks the main leg extension as anchor', () => {
    expect(result.version).toBe(PHRASE_ALGORITHM_VERSION)
    expect(isPhraseResult(result)).toBe(true)
    expect(result.tracked_share).toBe(1)
    expect(result.label_doubt_share).toBe(0)
    const kinds = result.events.map((e) => e.kind)
    for (const k of ['plie', 'gesture', 'tilt', 'turn']) expect(kinds).toContain(k)
    const gestures = result.events.filter((e) => e.kind === 'gesture')
    expect(gestures.map((g) => g.side)).toEqual(['right', 'left'])
    expect(gestures.every((g) => !('side' in g.values))).toBe(true)
    const anchor = result.events[result.anchor as number]
    expect(anchor.kind).toBe('gesture')
    expect(anchor.side).toBe('right')
    expect(anchor.values.direction).toBe('side')
  })

  it('measures every theme, with a value and a confidence, never a score', () => {
    const { themes } = result
    expect(Object.keys(themes).sort()).toEqual([...THEME_KEYS].sort())
    expect(themes.knee_over_toes.value).toBeCloseTo(10, 0)
    expect(themes.knee_over_toes.parts.left_deg).toBeCloseTo(10, 0)
    expect(themes.knee_over_toes.parts.right_deg).toBeCloseTo(10, 0)
    expect(themes.upper_body_curve.value as number).toBeGreaterThan(30)
    expect(themes.neck_range.value as number).toBeGreaterThan(30)
    expect(themes.arm_reach.value as number).toBeGreaterThan(0.9)
    expect(themes.circle_completion.value as number).toBeGreaterThan(330)
    expect(themes.circle_completion.parts.limb).toBe('right_arm')
    for (const k of THEME_KEYS) {
      const t = themes[k]
      expect(['high', 'medium', 'low']).toContain(t.confidence.level)
      if (t.value === null) expect(t.confidence.reason).toBeTruthy()
      else expect(t.confidence.reason).toBeUndefined()
      expect(JSON.stringify(t)).not.toMatch(/score"?:\s*"|grade|good|bad/i)
    }
  })

  it('says why a theme is missing instead of filling it in', () => {
    const still = computePhrase(phraseSeries(() => STAND, 4))
    expect(still.events).toEqual([])
    expect(still.anchor).toBeNull()
    expect(still.themes.knee_over_toes).toMatchObject({ value: null, confidence: { reason: 'no_plie_detected' } })
    expect(still.themes.circle_completion).toMatchObject({ value: null, confidence: { reason: 'no_circle_detected' } })
    expect(still.themes.head_lead.value).toBeNull()
    expect(still.themes.head_lead.confidence.reason).toBe('no_paired_onsets')
  })

  it('a clip without any pose is all gaps with reason no_pose', () => {
    const s = phraseSeries(() => STAND, 2)
    const empty = { ...s, frames: s.frames.map((f) => ({ t: f.t, image: null, world: null })) }
    const r = computePhrase(empty)
    expect(r.tracked_share).toBe(0)
    for (const k of THEME_KEYS) expect(r.themes[k]).toMatchObject({ value: null, confidence: { reason: 'no_pose' } })
  })

  it('does not trust swapped left/right labels: side-dependent themes are noted and lowered, events marked', () => {
    const swapped = computePhrase(swapLabels(phraseSeries(phrase(), 13)))
    expect(swapped.label_doubt_share as number).toBeGreaterThan(0.8)
    for (const k of ['knee_over_toes', 'upper_body_curve', 'circle_completion'] as const) {
      const t = swapped.themes[k]
      if (t.value === null) continue
      expect(t.confidence.notes).toContain('left_right_labels_uncertain')
      expect(t.confidence.level).not.toBe('high')
    }
    // Neck range does not depend on sides.
    expect(swapped.themes.neck_range.confidence.notes ?? []).not.toContain('left_right_labels_uncertain')
    const gestures = swapped.events.filter((e) => e.kind === 'gesture')
    expect(gestures.length).toBeGreaterThan(0)
    for (const g of gestures) expect(g.side_uncertain).toBe(true)
  })

  it('caps the depth-dependent themes at low confidence and leaves the others alone', () => {
    const r = computePhrase(phraseSeries(phrase(), 21))
    const measured = THEME_KEYS.filter((k) => r.themes[k].value !== null)
    expect(measured.length).toBeGreaterThan(2)
    for (const k of measured) {
      if (DEPTH_LIMITED.has(k)) expect(r.themes[k].confidence.level).toBe('low')
      else expect(r.themes[k].confidence.level).not.toBe('low')
    }
    // Shown with its value, never hidden: the cap changes the level only.
    for (const k of DEPTH_LIMITED) if (r.themes[k].value !== null) expect(r.themes[k].confidence.reason).toBeUndefined()
  })

  it('reads stored keypoints whose unswapper lost track as the tracker labelled them', () => {
    // Stored series where a missed swap-back left frames 30 onwards exchanged and marked relabeled.
    const clean = phraseSeries(phrase(), 13)
    const swappedAll = swapLabels(clean)
    const stored: PoseSeries = {
      ...clean,
      frames: clean.frames.map((f, i) => (i >= 30 ? { ...swappedAll.frames[i], relabeled: true as const } : f)),
    }
    const r = computePhrase(stored)
    expect(r.version).toBe(PHRASE_ALGORITHM_VERSION)
    expect(r.label_doubt_share).toBe(0)
    expect(r.themes).toEqual(result.themes)
    expect(r.events.filter((e) => e.kind === 'gesture').map((g) => g.side)).toEqual(['right', 'left'])
    // A short relabeled glitch (under MAX_SWAP_S) is kept as the unswapper left it.
    const glitch: PoseSeries = {
      ...clean,
      frames: clean.frames.map((f, i) => (i >= 30 && i < 35 ? { ...f, relabeled: true as const } : f)),
    }
    expect(computePhrase(glitch).themes).toEqual(result.themes)
  })

  it('stays well under the storage limit', () => {
    expect(JSON.stringify(result).length).toBeLessThan(64_000)
  })
})

describe('computeAttempt', () => {
  it('phrase: relevé columns are null with reason not_applicable, the phrase result is attached', () => {
    const r = computeAttempt(phraseSeries(phrase(), 13), 'phrase')
    expect(r.movement).toBe('phrase')
    expect(r.algorithm_version).toBe(PHRASE_ALGORITHM_VERSION)
    for (const k of ['trunk_inclination_deg', 'pelvis_ankle_offset_norm', 'balance_duration_s', 'knee_tracking_dev_deg', 'turn_count'] as const) {
      expect(r[k]).toBeNull()
      expect(r.confidence[k].reason).toBe('not_applicable')
    }
    expect(r.phases).toEqual([])
    expect(isPhraseResult(r.phrase)).toBe(true)
  })

  it('relevé balance is unchanged and has no phrase result', () => {
    const s = phraseSeries((t) => at({ heelLift: 0.1 * bump(t, 1.5, 4, 0.4) }), 5)
    const r = computeAttempt(s, 'releve_balance')
    expect(r.phrase).toBeNull()
    expect(r.algorithm_version).toBe(ALGORITHM_VERSION)
    expect(r).toEqual({ ...computeMetrics(s, 'releve_balance'), phrase: null })
  })
})

describe('alignPhrases', () => {
  const a = computePhrase(phraseSeries(phrase(0), 13))

  it('matches the same phrase danced 2 s later and 10% slower, step by step', () => {
    const b = computePhrase(phraseSeries(phrase(2, 1.1), 16))
    const al = alignPhrases(a, b)
    expect(al.pairs.length).toBeGreaterThanOrEqual(4)
    for (const p of al.pairs) expect(a.events[p.a].kind).toBe(b.events[p.b].kind)
    // Every matched peak in B is where the stretch puts it.
    for (const [tA, tB] of al.anchors) expect(Math.abs(tB - (2 + tA * 1.1))).toBeLessThan(0.35)
    for (let i = 1; i < al.anchors.length; i++) {
      expect(al.anchors[i][0]).toBeGreaterThan(al.anchors[i - 1][0])
      expect(al.anchors[i][1]).toBeGreaterThan(al.anchors[i - 1][1])
    }
    const anchor = al.anchorPair
    expect(anchor).not.toBeNull()
    expect(a.events[anchor!.a].side).toBe('right')
    expect(b.events[anchor!.b].side).toBe('right')
    expect(al.offsetS as number).toBeGreaterThan(2)
  })

  it('never pairs a right leg with a left leg when both sides are certain', () => {
    const r = a.events.find((e) => e.kind === 'gesture' && e.side === 'right')!
    const l = a.events.find((e) => e.kind === 'gesture' && e.side === 'left')!
    expect(similarity(r, l)).toBe(0)
    expect(similarity(r, { ...l, side_uncertain: true })).toBeGreaterThan(0)
    expect(similarity(r, a.events.find((e) => e.kind === 'turn')!)).toBe(0)
  })

  it('no events in common → no pairs, no anchors, no offset', () => {
    const still = computePhrase(phraseSeries(() => STAND, 4))
    const al = alignPhrases(a, still)
    expect(al).toEqual({ pairs: [], anchors: [], offsetS: null, anchorPair: null })
  })

  it('works on stored results as plain JSON', () => {
    const b = JSON.parse(JSON.stringify(computePhrase(phraseSeries(phrase(1), 14)))) as PhraseResult
    expect(alignPhrases(a, b).pairs.length).toBeGreaterThan(3)
  })
})
