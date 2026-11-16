import { describe, expect, it } from 'vitest'
import { layoutSeries } from './chart'
import { attempt, metrics, note, session, trunkSession } from './fixtures'
import {
  NO_FILTERS,
  PERSONAL,
  buildLibrary,
  buildTrend,
  describeFilters,
  groupStatus,
  mobileGroups,
  nextFocus,
  niceMax,
  pickFocus,
  prettyDates,
  recentNotes,
  sessionNumbers,
  sessionTarget,
  showMoreLabel,
  tileKind,
  type SubjectGroup,
} from './model'
import { toNotes } from './notes'

const NOW = new Date('2026-11-15T12:00:00')
const TRUNK = 'trunk_inclination_deg' as const

describe('tileKind', () => {
  const s = session('s1')
  it('tells done, low confidence and no tracking apart', () => {
    expect(tileKind(attempt('a', s, 1, {}, metrics('a', { trunk_inclination_deg: 4.2 })))).toBe('done')
    expect(tileKind(attempt('a', s, 1, {}, metrics('a', { trunk_inclination_deg: 4.2 }, { trunk_inclination_deg: 'low' })))).toBe('low')
    expect(tileKind(attempt('a', s, 1, {}, metrics('a', {})))).toBe('none')
    expect(tileKind(attempt('a', s, 1, {}, null))).toBe('none')
  })
  it('treats a stale processing row as queued and lets the live queue win', () => {
    const stale = attempt('a', s, 1, { status: 'processing' })
    expect(tileKind(stale)).toBe('queued')
    expect(tileKind(stale, new Map([['a', 'processing']]))).toBe('processing')
    expect(tileKind(attempt('b', s, 2, { status: 'failed', error: 'x' }))).toBe('failed')
  })
})

describe('buildLibrary', () => {
  const s1a = session('s1a', { subject_code: 'S01', recorded_on: '2026-10-28', created_at: '2026-10-28T10:00:00Z' })
  const s1b = session('s1b', { subject_code: 'S01', recorded_on: '2026-11-04', created_at: '2026-11-04T10:00:00Z' })
  const s2 = session('s2', { subject_code: 'S02', movement_type: 'pirouette', camera_view: 'front', recorded_on: '2026-11-05', created_at: '2026-11-05T10:00:00Z' })
  const mine = session('p1', { recorded_on: '2026-11-06', created_at: '2026-11-06T10:00:00Z' })
  const sessions = [mine, s2, s1b, s1a] // newest first, as the hook returns them
  const attempts = [
    attempt('p1-1', mine, 1, { status: 'queued', clip_name: 'home_take.mp4' }),
    attempt('s2-1', s2, 1, { status: 'failed', error: 'Clip shorter than 2 s.' }),
    attempt('s2-2', s2, 2, {}, metrics('s2-2', { trunk_inclination_deg: 3 })),
    attempt('s1b-1', s1b, 1, {}, metrics('s1b-1', { trunk_inclination_deg: 5 })),
    attempt('s1b-2', s1b, 2, {}, metrics('s1b-2', {})),
    attempt('s1a-1', s1a, 1, {}, metrics('s1a-1', { trunk_inclination_deg: 6 }, { trunk_inclination_deg: 'low' })),
  ]

  it('groups by subject code, personal videos last, sessions newest first', () => {
    const m = buildLibrary(sessions, attempts, NO_FILTERS, undefined, NOW)
    expect(m.groups.map((g) => g.key)).toEqual(['S01', 'S02', PERSONAL])
    const s01 = m.groups[0]
    expect(s01.summary).toBe('3 clips · 2 sessions')
    expect(s01.sessions.map((b) => b.title)).toEqual(['Relevé balance · Session 2', 'Relevé balance · Session 1'])
    expect(s01.sessions[0].meta).toBe('Nov 4 · side view · 2 attempts')
    expect(s01.status).toEqual({ status: 'done', text: '3 done · 1 low confidence · 1 no tracking' })
    expect(m.groups[1].status).toEqual({ status: 'failed', text: '1 failed' })
    expect(m.groups[2].code).toBeNull()
    expect(m.groups[2].status).toEqual({ status: 'queued', text: '1 queued' })
  })

  it('counts every status under the other filters', () => {
    const all = buildLibrary(sessions, attempts, NO_FILTERS)
    expect(all.counts).toEqual({ all: 6, done: 4, processing: 0, queued: 1, failed: 1 })
    const failed = buildLibrary(sessions, attempts, { ...NO_FILTERS, status: 'failed' })
    expect(failed.counts.all).toBe(6)
    expect(failed.shown).toBe(1)
    expect(failed.groups.map((g) => g.key)).toEqual(['S02'])
    const pir = buildLibrary(sessions, attempts, { ...NO_FILTERS, movement: 'pirouette' })
    expect(pir.counts).toEqual({ all: 2, done: 1, processing: 0, queued: 0, failed: 1 })
  })

  it('filters by search, subject, view and needs-attention', () => {
    expect(buildLibrary(sessions, attempts, { ...NO_FILTERS, q: 'home' }).shown).toBe(1)
    expect(buildLibrary(sessions, attempts, { ...NO_FILTERS, q: 's02' }).shown).toBe(2)
    expect(buildLibrary(sessions, attempts, { ...NO_FILTERS, subject: PERSONAL }).shown).toBe(1)
    expect(buildLibrary(sessions, attempts, { ...NO_FILTERS, view: 'front' }).shown).toBe(2)
    expect(buildLibrary(sessions, attempts, { ...NO_FILTERS, attention: true }).shown).toBe(3)
    expect(buildLibrary(sessions, attempts, { ...NO_FILTERS, subject: 'S02', view: 'side' }).shown).toBe(0)
    expect(describeFilters({ ...NO_FILTERS, subject: 'S02', movement: 'pirouette', view: 'diagonal' })).toBe('S02 · Pirouette · Diagonal view')
  })

  it('uses the live queue for processing clips', () => {
    const m = buildLibrary(sessions, attempts, NO_FILTERS, new Map([['p1-1', 'processing']]))
    expect(m.counts.processing).toBe(1)
    expect(m.groups[2].status).toEqual({ status: 'processing', text: '1 processing' })
  })

  it('numbers sessions per subject and movement, oldest first', () => {
    const n = sessionNumbers(sessions, attempts)
    expect([n.get('s1a'), n.get('s1b'), n.get('s2'), n.get('p1')]).toEqual([1, 2, 1, 1])
  })

  it('builds the phone rows', () => {
    const groups = mobileGroups(buildLibrary(sessions, attempts, NO_FILTERS, undefined, NOW).groups, NOW)
    expect(groups.map((g) => g.title)).toEqual(['S01 · Relevé balance', 'S02 · Pirouette', 'Personal videos · Relevé balance'])
    expect(groups[0].rows[0].title).toBe('Session 2 · Nov 4')
    expect(groups[0].rows[0].status.text).toBe('2 attempts · 1 no tracking')
    expect(groups[1].rows[0].status).toEqual({ status: 'failed', text: '1 failed · tap to see why' })
    expect(groups[1].rows[0].attemptId).toBe('s2-1')
    expect(groups[2].rows[0].status).toEqual({ status: 'queued', text: '0 of 1 processed · side view' })
    const block = buildLibrary(sessions, attempts).groups[0].sessions[0]
    expect(sessionTarget(block).id).toBe('s1b-2')
  })

  it('labels the folded groups', () => {
    const g = (code: string | null): SubjectGroup => ({ key: code ?? PERSONAL, code, summary: '', status: groupStatus([]), sessions: [], active: false })
    expect(showMoreLabel([g('S07'), g('S08'), g('S12')])).toBe('Show S07–S12 (3 more subjects)')
    expect(showMoreLabel([g('S07')])).toBe('Show S07 (1 more subject)')
  })
})

describe('pickFocus and buildTrend', () => {
  const one = trunkSession('one', { subject_code: 'S01', recorded_on: '2026-10-28', created_at: '2026-10-28T10:00:00Z' }, [6.8, 7.0, 6.6])
  const two = trunkSession('two', { subject_code: 'S01', recorded_on: '2026-11-04', created_at: '2026-11-04T10:00:00Z' }, [5.6, null])
  const three = trunkSession('three', { subject_code: 'S01', recorded_on: '2026-11-11', created_at: '2026-11-11T10:00:00Z' }, [4.9])
  const queued = attempt('three-a2', three.s, 2, { status: 'queued' })
  const other = trunkSession('other', { subject_code: 'S02', recorded_on: '2026-11-12', created_at: '2026-11-12T10:00:00Z' }, [20])
  const sessions = [other.s, three.s, two.s, one.s]
  const attempts = [...other.a, ...three.a, queued, ...two.a, ...one.a]

  it('never mixes subjects', () => {
    const latest = pickFocus(sessions, attempts)!
    expect(latest.key).toBe('S02')
    const s01 = pickFocus(sessions, attempts, { subject: 'S01', movement: 'all' })!
    expect(s01.sessions.map((s) => s.id)).toEqual(['three', 'two', 'one'])
    expect(s01.attempts.every((a) => a.session.subject_code === 'S01')).toBe(true)
    expect(pickFocus([], [])).toBeNull()
  })

  it('shows session medians, the partial session and the insights sentence', () => {
    const t = buildTrend(pickFocus(sessions, attempts, { subject: 'S01', movement: 'all' })!, TRUNK, 6, NOW)
    expect(t.points.map((p) => p.text)).toEqual(['6.8°', '5.6°', '4.9°'])
    expect(t.points.map((p) => p.label)).toEqual(['Session 1', 'Session 2', 'Session 3 · partial'])
    expect(t.max).toBe(8)
    expect(t.sentence).toBe('Median on Nov 11 is 1.9° less lean than on Oct 28.')
    expect(t.notes).toEqual(['Session 3 has 1 of 2 attempts processed.'])
    expect(t.reason).toBeNull()
    expect(t.aria).toContain('session 3 4.9° (1 of 2 attempts processed)')
  })

  it('keeps a session without values as a gap with its reason', () => {
    const a = trunkSession('a', { recorded_on: '2026-11-01' }, [null, null])
    const b = trunkSession('b', { recorded_on: '2026-11-08', created_at: '2026-11-08T10:00:00Z' }, [null])
    const t = buildTrend(pickFocus([b.s, a.s], [...b.a, ...a.a])!, TRUNK, 6, NOW)
    expect(t.points.map((p) => p.median)).toEqual([null, null])
    expect(t.max).toBeNull()
    expect(t.sentence).toBe('No session has a value for this yet.')
    expect(t.reason).toBe('The landmarks this needs weren’t tracked during the phase.')
    const layout = layoutSeries(t.points.map((p) => p.median), t.max, { left: 40, right: 260, top: 20, bottom: 90 })
    expect(layout.lines).toEqual([])
    expect(layout.dots.map((d) => d.y)).toEqual([null, null])
  })

  it('needs two sessions to say anything about change', () => {
    const t = buildTrend(pickFocus([one.s], one.a)!, TRUNK, 6, NOW)
    expect(t.sentence).toBe('Needs two sessions with a value to show change.')
  })
})

describe('chart layout', () => {
  it('breaks the line at a gap and never draws it at zero', () => {
    const l = layoutSeries([2, null, 4, 8], 8, { left: 0, right: 90, top: 0, bottom: 80 })
    expect(l.dots.map((d) => [d.x, d.y])).toEqual([[0, 60], [30, null], [60, 40], [90, 0]])
    expect(l.lines).toEqual(['60,40 90,0'])
    expect(layoutSeries([5], 10, { left: 0, right: 100, top: 0, bottom: 10 }).dots[0]).toEqual({ index: 0, x: 50, y: 5 })
  })
  it('picks a round axis top', () => {
    expect([niceMax(6.8), niceMax(0.1), niceMax(3.4), niceMax(0)]).toEqual([8, 0.2, 4, 1])
  })
})

describe('notes', () => {
  const s = session('s1', { subject_code: 'S01', recorded_on: '2026-11-04' })
  const a1 = attempt('a1', s, 1, {}, metrics('a1', { trunk_inclination_deg: 4.2 }))
  const a2 = attempt('a2', s, 2, {}, metrics('a2', { trunk_inclination_deg: 5 }))
  const notes = [note('n1', 'a1', '2026-11-04T18:00:00Z'), note('n2', 'a2', '2026-11-05T18:00:00Z'), note('n3', 'gone', '2026-11-06T18:00:00Z')]

  it('takes the next focus from the newest note of an attempt that still exists', () => {
    const f = nextFocus(notes, [a1, a2], undefined, NOW)!
    expect(f.attemptId).toBe('a2')
    expect(f.title).toBe('Hold phase — torso lean')
    expect(f.observation).toBe('Synthetic observation.')
    expect(f.from).toBe('From notes, Nov 5')
    expect(f.ribbon?.filter((p) => p.current).map((p) => p.label)).toEqual(['Hold'])
    expect(f.valueText).toBe('5.0°')
  })

  it('has no next focus without notes', () => {
    expect(nextFocus([], [a1, a2])).toBeNull()
    expect(nextFocus(notes, [a1, a2], 'S09')).toBeNull()
  })

  it('lists recent notes with their session and attempt', () => {
    expect(recentNotes(notes, [s], [a1, a2], 3, NOW)).toEqual([
      { id: 'n2', attemptId: 'a2', title: 'S01 · Session 1 · Attempt 2', meta: 'Nov 5 · 1 observation' },
      { id: 'n1', attemptId: 'a1', title: 'S01 · Session 1 · Attempt 1', meta: 'Nov 4 · 1 observation' },
    ])
  })

  it('skips stored rows that do not match the contract', () => {
    const good = notes[0]
    const rows = [
      { id: 'x', attempt_id: 'a1', model: 'm', prompt_version: 'v', created_at: 't', response: good.response },
      { id: 'y', attempt_id: 'a1', model: 'm', prompt_version: 'v', created_at: 't', response: { summary: 'only' } },
    ]
    expect(toNotes(rows).map((n) => n.id)).toEqual(['x'])
  })
})

describe('prettyDates', () => {
  it('rewrites ISO days only', () => {
    expect(prettyDates('Median on 2026-11-11 is 1.9° less lean than on 2026-10-28', NOW)).toBe('Median on Nov 11 is 1.9° less lean than on Oct 28')
  })
})
