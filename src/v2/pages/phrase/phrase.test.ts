// View models of phrase attempts: theme readings, neutral differences, focus order, event
// layout, the event time map of Compare, Progress across sessions, the dataset name pattern
// and focus cleaning. Synthetic values only; no participant data.

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { cleanFocus } from '../../../data/preferences'
import { computePhrase, THEME_KEYS, type PhraseEventOut, type PhraseResult, type ThemeKey } from '../../../metrics/phrase'
import { alignPhrases } from '../../../metrics/phraseAlign'
import { bump, phraseSeries, STAND } from '../../../metrics/testing/phraseDancer'
import { buildEventTimeMap } from '../compare/align'
import { parseTags } from '../import/model'
import { attempt, session } from '../notes/fixtures'
import { buildPhraseProgress, phraseTiles } from '../progress/phraseModel'
import {
  compareThemes,
  eventDescription,
  eventShort,
  eventSummary,
  labelDoubtText,
  layoutEvents,
  orderThemes,
  phraseOf,
  readTheme,
  themeDifference,
  toggleFocus,
} from './model'
import { ThemeCards } from './ThemeCards'

const NOW = new Date('2026-11-17T12:00:00')
const JUDGEMENT = /\b(better|worse|good|bad|correct|incorrect|improv|score|grade|great|poor)/i

function result(values: Partial<Record<ThemeKey, number | null>>, opts: { level?: 'high' | 'medium' | 'low'; events?: PhraseEventOut[]; doubt?: number } = {}): PhraseResult {
  const themes = Object.fromEntries(
    THEME_KEYS.map((k) => {
      const v = values[k] ?? null
      return [k, v === null ? { value: null, parts: {}, confidence: { level: 'low', score: 0, reason: k === 'knee_over_toes' ? 'no_plie_detected' : 'no_valid_frames' } } : { value: v, parts: {}, confidence: { level: opts.level ?? 'high', score: 0.9 } }]
    }),
  ) as PhraseResult['themes']
  return { version: 'mt2-phrase-0.1.0', duration_s: 20, tracked_share: 1, label_doubt_share: opts.doubt ?? 0, leg_length_m: 0.9, events: opts.events ?? [], anchor: null, circles: [], themes }
}

const gesture = (start: number, side: 'left' | 'right', over: Partial<PhraseEventOut> = {}): PhraseEventOut => ({
  kind: 'gesture',
  start,
  end: start + 1,
  peak: start + 0.5,
  side,
  values: { peak_elevation_deg: 90, direction: 'side', level: 'hip or above', working_knee_deg: 5, held_s: 0.6 },
  ...over,
})

describe('theme readings', () => {
  it('reads a value with its sign in words and a view note when the view is not a good one', () => {
    const r = readTheme(result({ knee_over_toes: 6.24 }), 'knee_over_toes', 'side')
    expect(r.text).toBe('6.2')
    expect(r.shown).toBe(6.2)
    expect(r.signText).toBe('knee inside the foot line')
    expect(r.viewNote).toMatch(/front or the diagonal/)
    expect(readTheme(result({ head_lead: -0.2 }), 'head_lead').signText).toBe('arms start first')
    expect(readTheme(result({ knee_over_toes: 3 }), 'knee_over_toes', 'front').viewNote).toBeNull()
  })

  it('a missing value is a gap with its reason, never 0', () => {
    const r = readTheme(result({}), 'knee_over_toes')
    expect(r.value).toBeNull()
    expect(r.text).toBe('—')
    expect(r.confidence).toBe('none')
    expect(r.reason).toMatch(/No plié/)
    expect(readTheme(null, 'arm_reach').reason).toMatch(/hasn’t been processed as a phrase/)
  })

  it('phraseOf only accepts a stored phrase result', () => {
    expect(phraseOf({ phrase: result({}) })).not.toBeNull()
    expect(phraseOf({ phrase: { foo: 1 } })).toBeNull()
    expect(phraseOf(null)).toBeNull()
  })
})

describe('neutral differences', () => {
  it('words B − A on the rounded values, without judging', () => {
    const a = result({ arm_reach: 1.3, knee_over_toes: 4, head_lead: -0.2, circle_completion: 300, neck_range: 50, upper_body_curve: 40 })
    const b = result({ arm_reach: 1.38, knee_over_toes: 1.5, head_lead: -0.1, circle_completion: 340, neck_range: 50, upper_body_curve: 52 })
    const rows = compareThemes(a, b)
    const by = Object.fromEntries(rows.map((r) => [r.key, r]))
    expect(by.arm_reach.sentence).toBe('B reaches 0.08 arm lengths further than A.')
    expect(by.knee_over_toes.sentence).toBe('B: knees 2.5° more towards the outside of the foot line than A.')
    expect(by.head_lead.sentence).toBe('B: the head starts 0.10 s earlier relative to the arms than in A.')
    expect(by.circle_completion.sentence).toBe('B’s largest circle sweeps 40° more than A’s.')
    expect(by.neck_range.sentence).toBe('B and A read the same.')
    expect(by.upper_body_curve.sentence).toBe('B is 12° more curled than A.')
    for (const r of rows) expect(r.sentence).not.toMatch(JUDGEMENT)
  })

  it('does not compare across a gap and says which side is missing; flags low confidence', () => {
    const d = themeDifference('arm_reach', readTheme(result({ arm_reach: 1.2 }), 'arm_reach'), readTheme(result({}), 'arm_reach'))
    expect(d.delta).toBeNull()
    expect(d.sentence).toBe('Not compared: no value in B.')
    const low = compareThemes(result({ neck_range: 40 }, { level: 'low' }), result({ neck_range: 46 }))
    expect(low.find((r) => r.key === 'neck_range')!.sentence).toMatch(/low confidence/)
  })
})

describe('focus themes', () => {
  it('puts the focus first, keeps at most three and drops the oldest pick', () => {
    expect(orderThemes(['arm_reach', 'head_lead']).slice(0, 2)).toEqual(['arm_reach', 'head_lead'])
    expect(orderThemes(['arm_reach'])).toHaveLength(THEME_KEYS.length)
    let f: ThemeKey[] = []
    for (const k of ['arm_reach', 'head_lead', 'neck_range', 'knee_over_toes'] as ThemeKey[]) f = toggleFocus(f, k)
    expect(f).toEqual(['head_lead', 'neck_range', 'knee_over_toes'])
    expect(toggleFocus(f, 'neck_range')).toEqual(['head_lead', 'knee_over_toes'])
  })

  it('cleans what comes back from the database (known keys, no repeats, three at most)', () => {
    expect(cleanFocus(['arm_reach', 'nope', 'arm_reach', 'head_lead', 'neck_range', 'circle_completion'])).toEqual(['arm_reach', 'head_lead', 'neck_range'])
  })

  it('theme cards render focus first, with “What does this mean?”, and no judging words', () => {
    const html = renderToStaticMarkup(
      createElement(ThemeCards, {
        phrase: result({ arm_reach: 1.3, head_lead: 0.1, neck_range: 50, upper_body_curve: 40, circle_completion: 300 }),
        view: 'diagonal',
        focus: ['neck_range'],
        onToggleFocus: () => undefined,
        detail: false,
        narrow: false,
      }),
    )
    expect(html.indexOf('Neck movement range')).toBeLessThan(html.indexOf('Head leads the arms'))
    expect(html).toContain('What does this mean?')
    expect(html).toContain('My focus')
    expect(html).toContain('no plié in this clip')
    expect(html.replace(/<[^>]+>/g, ' ')).not.toMatch(JUDGEMENT)
  })
})

describe('events on the timeline', () => {
  const phrase = result({}, { events: [gesture(2, 'right'), { kind: 'tilt', start: 4, end: 6, peak: 5, values: { peak_deg: 86, direction: 'forward' } }, gesture(8, 'left', { side_uncertain: true })] })
  phrase.anchor = 0

  it('lays events out in lanes, marks the anchor and maps another attempt’s times', () => {
    const laid = layoutEvents(phrase, 20)
    expect(laid.map((e) => e.lane)).toEqual([0, 1, 0])
    expect(laid[0].left).toBeCloseTo(0.1)
    expect(laid[0].anchor).toBe(true)
    const shifted = layoutEvents(phrase, 20, (t) => t + 1)
    expect(shifted[0].left).toBeCloseTo(0.15)
  })

  it('names events plainly, and says when a side may be swapped', () => {
    expect(eventShort(phrase.events[0])).toBe('R side 90°')
    expect(eventShort(phrase.events[1])).toBe('Fold fwd 86°')
    expect(eventShort(phrase.events[2])).toBe('L? side 90°')
    expect(eventDescription(phrase.events[2])).toMatch(/may be swapped/)
    expect(eventSummary(phrase)).toBe('3 events: 2 leg gestures, 1 fold or tilt')
    expect(labelDoubtText(result({}, { doubt: 0.3 }))).toMatch(/30%/)
    expect(labelDoubtText(result({}, { doubt: 0.02 }))).toBeNull()
  })
})

describe('Compare: event time map', () => {
  it('runs through the matched peaks and keeps the same speed before the first and after the last', () => {
    const map = buildEventTimeMap(20, 22, [
      [5, 7],
      [10, 13],
    ])
    expect(map.mode).toBe('events')
    expect(map.toB(5)).toBeCloseTo(7)
    expect(map.toB(7.5)).toBeCloseTo(10)
    expect(map.toB(2)).toBeCloseTo(4)
    expect(map.toB(15)).toBeCloseTo(18)
    expect(map.toA(13)).toBeCloseTo(10)
  })

  it('falls back to clip length without matches, or when asked', () => {
    expect(buildEventTimeMap(20, 10, []).mode).toBe('proportional')
    expect(buildEventTimeMap(20, 10, []).unavailable).toBe('none_in_common')
    const asked = buildEventTimeMap(20, 10, [[5, 3]], 'proportional')
    expect(asked.mode).toBe('proportional')
    expect(asked.unavailable).toBeNull()
  })

  it('end to end: two synthetic attempts line up on their main leg extension', () => {
    const make = (delay: number) =>
      phraseSeries((t) => {
        const u = t - delay
        if (u >= 1 && u < 2.5) return { ...STAND, gesture: { side: 'right', elevDeg: 90 * bump(u, 1, 2.5, 0.4), azDeg: 90 } }
        if (u >= 3.5 && u < 5) return { ...STAND, trunkDeg: 80 * bump(u, 3.5, 5, 0.4) }
        return STAND
      }, 7)
    const a = computePhrase(make(0))
    const b = computePhrase(make(1.5))
    const al = alignPhrases(a, b)
    const map = buildEventTimeMap(7, 7, al.anchors)
    const peakA = a.events[al.anchorPair!.a].peak
    expect(map.toB(peakA)).toBeCloseTo(b.events[al.anchorPair!.b].peak, 1)
  })
})

describe('Progress: phrase themes across sessions', () => {
  const p1 = session('p1', '2026-11-01', { movement: 'phrase', view: 'diagonal' })
  const p2 = session('p2', '2026-11-08', { movement: 'phrase', view: 'diagonal' })
  const pf = session('pf', '2026-11-09', { movement: 'phrase', view: 'front' })
  const rel = session('r1', '2026-11-05', { movement: 'releve_balance', view: 'diagonal' })
  const withPhrase = (id: string, s: ReturnType<typeof session>, n: number, values: Partial<Record<ThemeKey, number | null>>, level?: 'high' | 'low') => {
    const a = attempt(id, s, n, {})
    a.metrics = { ...a.metrics!, phrase: result(values, { level }) }
    return a
  }
  const attempts = [
    withPhrase('a1', p1, 1, { arm_reach: 1.3 }),
    withPhrase('a2', p1, 2, { arm_reach: 1.32 }),
    withPhrase('b1', p2, 1, { arm_reach: 1.4 }),
    withPhrase('b2', p2, 2, { arm_reach: 2.5 }, 'low'),
    withPhrase('f1', pf, 1, { arm_reach: 9 }),
    attempt('r', rel, 1, { trunk_inclination_deg: 5 }),
  ]
  const view = buildPhraseProgress([pf, p2, rel, p1], attempts, {}, NOW)
  const reach = view.panels.find((p) => p.key === 'arm_reach')!

  it('charts phrase sessions of one view only, never relevé values', () => {
    expect(view.cameraView).toBe('diagonal')
    expect(view.sessions.map((s) => s.sessionId)).toEqual(['p1', 'p2'])
    expect(view.excluded.map((e) => e.sessionId)).toEqual(['pf'])
    expect(reach.sessions.flatMap((s) => s.points.map((p) => p.attemptId))).toEqual(['a1', 'a2', 'b1', 'b2'])
  })

  it('leaves low confidence out of the median and words the change neutrally', () => {
    expect(reach.sessions.map((s) => s.median)).toEqual([1.31, 1.4])
    expect(reach.summary).toBe('Medians 1.31 arm lengths → 1.40 arm lengths. Session 2 is 0.09 arm lengths further than Session 1.')
    expect(reach.summary).not.toMatch(JUDGEMENT)
    const knee = view.panels.find((p) => p.key === 'knee_over_toes')!
    expect(knee.empty).toBe(true)
    expect(knee.geometry.gaps.length).toBe(4)
  })

  it('dashboard tiles: latest median per theme, focus first', () => {
    const tiles = phraseTiles(view, ['arm_reach'])
    expect(tiles[0]).toMatchObject({ key: 'arm_reach', value: '1.40', none: false })
    expect(tiles[0].delta).toMatch(/Session 2 is 0.09 arm lengths further than Session 1/)
    expect(tiles.find((t) => t.key === 'neck_range')).toMatchObject({ value: '—', none: true })
  })
})

describe('Import: dataset clip names', () => {
  it('reads the view letter of D##_attN_[f|s|d] names and tags them as a phrase', () => {
    expect(parseTags('D01_att3_d.mp4')).toEqual({ subject: null, movement: 'phrase', view: 'diagonal', clipNumber: 3 })
    expect(parseTags('D01_att1_f.mov')).toMatchObject({ view: 'front', clipNumber: 1 })
    expect(parseTags('D12_att2_s.mp4')).toMatchObject({ view: 'side', movement: 'phrase' })
    // att0 has no valid clip number (1–999): left empty, never 0.
    expect(parseTags('D01_att0_s.mp4').clipNumber).toBeNull()
    // A lone letter elsewhere is not a view.
    expect(parseTags('S05_releve_s_01.mp4').view).toBeNull()
  })
})
