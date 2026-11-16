import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { attempt, session } from '../notes/fixtures'
import { ProgressChart } from './ProgressChart'
import { buildProgress, CHART, chartGeometry, defaultMovement, niceCeil, tableRows } from './model'

const NOW = new Date('2026-11-15T12:00:00')

// Three side-view sessions of relevé balance; the third is only partly processed.
const s1 = session('s1', '2026-10-28')
const s2 = session('s2', '2026-11-04')
const s3 = session('s3', '2026-11-11')
const front = session('s4', '2026-11-05', { view: 'front' })
const pir = session('s5', '2026-11-06', { movement: 'pirouette' })
const sessions = [s3, pir, front, s2, s1]

const trunk = (v: number) => ({ trunk_inclination_deg: v, balance_duration_s: 2 })
const attempts = [
  attempt('a1', s1, 1, trunk(7.1)),
  attempt('a2', s1, 2, trunk(6.8)),
  attempt('a3', s1, 3, trunk(6.4)),
  attempt('b1', s2, 1, trunk(6.0)),
  attempt('b2', s2, 2, { trunk_inclination_deg: { value: 4.2, level: 'low' }, balance_duration_s: 3 }),
  attempt('b3', s2, 3, { trunk_inclination_deg: { value: null, reason: 'no_valid_frames' }, balance_duration_s: 3 }),
  attempt('b4', s2, 4, trunk(5.6)),
  attempt('c1', s3, 1, trunk(5.1)),
  attempt('c2', s3, 2, trunk(4.7)),
  attempt('c3', s3, 3),
  attempt('f1', front, 1, trunk(9)),
  attempt('p1', pir, 1, { turn_count: 1 }),
]

const view = buildProgress(sessions, attempts, { movement: 'releve_balance' }, NOW)
const panel = view.panels.find((p) => p.key === 'trunk_inclination_deg')!

describe('niceCeil', () => {
  it('rounds the top of the scale up to a round number', () => {
    expect(niceCeil(7.1)).toBe(10)
    expect(niceCeil(3.5)).toBe(5)
    expect(niceCeil(0.16)).toBe(0.2)
    expect(niceCeil(0.2)).toBe(0.2)
    expect(niceCeil(12)).toBe(20)
    expect(niceCeil(2.2)).toBe(2.5)
    expect(niceCeil(0)).toBe(1)
  })
})

describe('buildProgress', () => {
  it('shows one movement and one camera view, oldest session first', () => {
    expect(view.cameraView).toBe('side')
    expect(view.views).toEqual(['front', 'side'])
    expect(view.sessions.map((s) => s.sessionId)).toEqual(['s1', 's2', 's3'])
    expect(view.panels.map((p) => p.key)).not.toContain('turn_count')
  })

  it('lists the sessions it leaves out with the reason, except other movements', () => {
    expect(view.excluded).toEqual([{ sessionId: 's4', what: 'Nov 5 · Front view', reason: 'Not shown: filmed from a different camera view' }])
  })

  it('marks a partly processed session and says how much of it is processed', () => {
    expect(view.sessions[2]).toMatchObject({ label: 'Nov 11 · partial', partial: true, attempts: 3, processed: 2 })
    expect(view.sessionsNote).toBe('3 sessions · 10 attempts · Nov 11 has 2 of 3 processed')
  })

  it('words the change with the insights sentence and readable dates', () => {
    expect(panel.series.state).toBe('ready')
    expect(panel.summary).toBe('Medians 6.8° → 5.8° → 4.9°. Median on Nov 11 is 1.9° less lean than on Oct 28.')
    expect(panel.phaseLabel).toBe('Hold')
    expect(panel.aria).toContain('Torso lean, Hold.')
    expect(panel.aria).toContain('Oct 28: 6.8°')
    expect(panel.aria).toContain('1 low-confidence value not counted in the medians')
    expect(panel.aria).toContain('2 attempts without a value')
  })

  it('switches view and date range', () => {
    const f = buildProgress(sessions, attempts, { movement: 'releve_balance', cameraView: 'front' }, NOW)
    expect(f.sessions.map((s) => s.sessionId)).toEqual(['s4'])
    expect(f.panels[0].series.state).toBe('needs_two_sessions')
    expect(f.panels[0].summary).toBe('Median 9.0° on Nov 5. Needs two sessions with a value to show change.')

    const d = buildProgress(sessions, attempts, { movement: 'releve_balance', from: '2026-11-01' }, NOW)
    expect(d.sessions.map((s) => s.sessionId)).toEqual(['s2', 's3'])
    expect(d.excluded.map((e) => e.reason)).toContain('Not shown: outside the selected dates')
  })

  it('explains a metric that has no value in any attempt', () => {
    const knee = view.panels.find((p) => p.key === 'knee_tracking_dev_deg')!
    expect(knee.series.state).toBe('no_data')
    expect(knee.maxLabel).toBeNull()
    expect(knee.summary).toBe('No values yet. The landmarks this needs weren’t tracked during the phase.')
    expect(knee.geometry.dots).toHaveLength(0)
    expect(knee.geometry.gaps).toHaveLength(10)
  })

  it('opens on the most recently practised movement', () => {
    expect(defaultMovement(sessions)).toBe('releve_balance')
    expect(defaultMovement([pir, s1])).toBe('pirouette')
    expect(defaultMovement([])).toBe('releve_balance')
  })
})

describe('chartGeometry', () => {
  const g = panel.geometry

  it('keeps one scale from 0 to a round maximum for all sessions', () => {
    expect([g.min, g.max]).toEqual([0, 10])
    expect(panel.maxLabel).toBe('10°')
    expect(panel.minLabel).toBe('0')
    const y = (v: number) => CHART.bottom - (v / 10) * (CHART.bottom - CHART.top)
    expect(g.dots.find((d) => d.attemptId === 'a1')!.y).toBeCloseTo(y(7.1), 1)
    expect(g.columns[0].tick!.y).toBeCloseTo(y(6.8), 1)
  })

  it('gives each session an equal column and spreads its attempts around the centre', () => {
    const w = (CHART.right - CHART.left) / 3
    expect(g.columns.map((c) => c.cx)).toEqual([0, 1, 2].map((i) => Math.round((CHART.left + (i + 0.5) * w) * 10) / 10))
    const xs = ['a1', 'a2', 'a3'].map((id) => g.dots.find((d) => d.attemptId === id)!.x)
    expect(xs[1]).toBeCloseTo(g.columns[0].cx, 1)
    expect(xs[1] - xs[0]).toBeCloseTo(12, 1)
    for (const d of g.dots) expect(d.x).toBeGreaterThan(CHART.left)
  })

  it('draws a low-confidence value hollow and keeps it out of the median', () => {
    expect(g.dots.find((d) => d.attemptId === 'b2')!.low).toBe(true)
    expect(g.dots.filter((d) => d.low)).toHaveLength(1)
    // Median of 6.0 and 5.6, without the low 4.2.
    expect(panel.series.sessions[1].median).toBeCloseTo(5.8)
  })

  it('leaves a missing value as a gap mark, never a point at zero', () => {
    expect(g.gaps.map((m) => m.attemptId)).toEqual(['b3', 'c3'])
    expect(g.dots.map((d) => d.attemptId)).not.toContain('b3')
    expect(g.dots.every((d) => d.y < CHART.bottom)).toBe(true)
  })

  it('joins the medians of neighbouring sessions and breaks the line at a session without one', () => {
    expect(g.medianPaths).toHaveLength(1)
    expect(g.medianPaths[0].split('L')).toHaveLength(3)
    expect(g.columns[2].partial).toBe(true)

    const gapped = buildProgress(
      [s1, s2, s3],
      [attempt('a1', s1, 1, trunk(7)), attempt('b1', s2, 1, { balance_duration_s: 2 }), attempt('c1', s3, 1, trunk(5))],
      { movement: 'releve_balance' },
      NOW,
    ).panels[0]
    expect(gapped.geometry.medianPaths).toEqual([])
    expect(gapped.geometry.columns.map((c) => c.tick !== null)).toEqual([true, false, true])
    expect(gapped.summary).toContain('Medians 7.0° → — → 5.0°.')
  })

  it('handles no sessions', () => {
    expect(chartGeometry([])).toEqual({ min: null, max: null, columns: [], dots: [], gaps: [], medianPaths: [] })
  })
})

describe('tableRows', () => {
  it('lists every attempt with the reason for a dash or an uncounted value', () => {
    const rows = tableRows(panel, NOW)
    expect(rows.map((r) => r.dateLabel)).toEqual(['Oct 28', 'Nov 4', 'Nov 11'])
    expect(rows[1].values.map((v) => v.text)).toEqual(['6.0°', '4.2°', '—', '5.6°'])
    expect(rows[1].values[1].note).toBe('Low confidence, not counted')
    expect(rows[1].values[2].note).toBe('The landmarks this needs weren’t tracked during the phase')
    expect(rows[1]).toMatchObject({ counted: 2, medianText: '5.8°' })
    expect(rows[2].values[2]).toMatchObject({ text: '—', note: 'No measurements yet' })
  })
})

describe('ProgressChart', () => {
  const html = renderToStaticMarkup(createElement(ProgressChart, { panel, sessions: view.sessions }))

  it('renders an image with a text alternative', () => {
    expect(html).toContain('role="img"')
    expect(html).toContain('aria-label="Torso lean, Hold. Session medians')
  })

  it('draws 7 solid dots, 1 hollow dashed dot, 2 gap marks and 3 median ticks', () => {
    expect(html.match(/<circle[^>]*fill="var\(--text-2\)"/g)).toHaveLength(7)
    expect(html.match(/<circle[^>]*stroke-dasharray="2 2"/g)).toHaveLength(1)
    expect(html.match(/l8 8M/g)).toHaveLength(2)
    expect(html.match(/stroke-width="3"/g)).toHaveLength(3)
    // Only the partly processed session has a dashed tick.
    expect(html.match(/stroke-dasharray="7 4"/g)).toHaveLength(1)
  })

  it('uses tokens only and labels the sessions', () => {
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,6}\b/)
    expect(html).toContain('Nov 11 · partial')
    expect(html).toContain('>10°<')
  })
})
