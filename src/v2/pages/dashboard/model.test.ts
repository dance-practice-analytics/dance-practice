import { describe, expect, it } from 'vitest'
import type { PipelineItem } from '../../pipeline'
import { attempt, metrics, note, session, trunkSession } from '../library/fixtures'
import { pickFocus } from '../library/model'
import {
  accountSummary,
  attentionItems,
  latestSession,
  metricTiles,
  otherMovement,
  practiceLine,
  processingSummary,
  recentActivity,
  studyProgress,
  subjectProgress,
} from './model'

const NOW = new Date('2026-11-15T12:00:00')

const one = trunkSession('one', { recorded_on: '2026-10-28', created_at: '2026-10-28T10:00:00Z' }, [6.8, 7.0, 6.6])
const two = trunkSession('two', { recorded_on: '2026-11-04', created_at: '2026-11-04T10:00:00Z' }, [5.6, 5.8])
const three = trunkSession('three', { recorded_on: '2026-11-11', created_at: '2026-11-11T10:00:00Z' }, [4.9])
const queued = attempt('three-a2', three.s, 2, { status: 'queued' })
const sessions = [three.s, two.s, one.s]
const attempts = [...three.a, queued, ...two.a, ...one.a]

function item(attemptId: string, over: Partial<PipelineItem>): PipelineItem {
  return {
    attemptId,
    movement: 'releve_balance',
    status: 'queued',
    step: null,
    fraction: 0,
    reason: null,
    recovery: null,
    frames: null,
    trackedFrames: null,
    startedAt: null,
    finishedAt: null,
    ...over,
  }
}

describe('latestSession', () => {
  it('describes the newest session and its review target', () => {
    const l = latestSession(sessions, attempts, undefined, NOW)!
    expect(l.title).toBe('Relevé balance · Session 3')
    expect(l.when).toBe('Nov 11 · side view')
    expect(l.attemptsText).toBe('2 attempts')
    expect(l.statusLine).toBe('1 done · 1 queued')
    expect(l.review?.id).toBe('three-a1')
  })
  it('has no review target before anything is processed', () => {
    const s = session('q')
    const l = latestSession([s], [attempt('q1', s, 1, { status: 'queued' })])!
    expect(l.review).toBeNull()
    expect(latestSession([s], [])).toBeNull()
  })
})

describe('metricTiles', () => {
  it('shows the latest median, the neutral change and no grade', () => {
    const t = metricTiles(pickFocus(sessions, attempts)!, NOW)
    expect(t.heading).toBe('Relevé balance · by session')
    const trunk = t.tiles.find((x) => x.metric === 'trunk_inclination_deg')!
    expect([trunk.value, trunk.unit, trunk.confidenceLabel]).toEqual(['4.9', '°', 'Clear view'])
    expect(trunk.delta).toBe('Median on Nov 11 is 1.9° less lean than on Oct 28')
    expect(trunk.note).toBeNull()
    expect(trunk.single).toBe(false)
    expect(t.caption).toBe('Session medians: Oct 28 → Nov 4 → Nov 11 (1 of 2 attempts processed so far). Compared with your own first session only.')
    expect(JSON.stringify(t)).not.toMatch(/better|worse|improv|good|bad|score/i)
  })

  it('shows a metric with no value as a gap with its reason, never 0', () => {
    const knee = metricTiles(pickFocus(sessions, attempts)!, NOW).tiles.find((x) => x.metric === 'knee_tracking_dev_deg')!
    expect(knee.none).toBe(true)
    expect(knee.value).toBe('—')
    expect(knee.confidenceLabel).toBe('Not seen')
    expect(knee.delta).toBeNull()
    expect(knee.note).toBe('The landmarks this needs weren’t tracked during the phase.')
  })

  it('reports the stored reason when every attempt of the latest session is processed', () => {
    const a = trunkSession('a', { recorded_on: '2026-11-01' }, [null, null])
    const tile = metricTiles(pickFocus([a.s], a.a)!, NOW).tiles[0]
    expect(tile.none).toBe(true)
    expect(tile.note).toBe('The landmarks this needs weren’t tracked during the phase.')
  })

  it('marks low-confidence values as left out of the median', () => {
    const s = session('low', { recorded_on: '2026-11-04' })
    const a = [
      attempt('l1', s, 1, {}, metrics('l1', { trunk_inclination_deg: 5 })),
      attempt('l2', s, 2, {}, metrics('l2', { trunk_inclination_deg: 9 }, { trunk_inclination_deg: 'low' })),
    ]
    const tile = metricTiles(pickFocus([s], a)!, NOW).tiles[0]
    expect([tile.value, tile.low, tile.confidenceLabel]).toEqual(['5.0', true, 'Low camera visibility'])
    expect(tile.note).toBe('1 attempt on Nov 4 had low camera visibility and is not in the median.')
    expect(tile.delta).toBe('Record another session to see change.')
    expect(tile.single).toBe(true)
    expect(tile.about).toBe('How far your torso tips away from straight up, from the hips to the shoulders.')
  })
})

describe('otherMovement', () => {
  it('is an empty state with a next step when the movement has no sessions', () => {
    const c = otherMovement(pickFocus(sessions, attempts)!, NOW)
    expect(c.movement).toBe('pirouette')
    expect(c.sessions).toBe(0)
    expect(c.value).toBe('—')
    expect(c.sentence).toBe('No pirouette sessions yet.')
  })
  it('shows the turn count median of the same subject', () => {
    const p = session('pir', { movement_type: 'pirouette', recorded_on: '2026-11-12', created_at: '2026-11-12T10:00:00Z' })
    const pa = [1, 1.25].map((v, i) => attempt(`pir-${i}`, p, i + 1, {}, { ...metrics(`pir-${i}`, { turn_count: v }), movement: 'pirouette' }))
    const c = otherMovement(pickFocus([p, ...sessions], [...pa, ...attempts], { subject: 'all', movement: 'releve_balance' })!, NOW)
    expect([c.sessions, c.value, c.unit]).toEqual([1, '1.13', 'turns · median'])
    expect(c.sentence).toBe('Turns: needs two sessions with a value to show change.')
  })
})

describe('processingSummary', () => {
  it('reports this tab’s queue with live progress', () => {
    const p = processingSummary(attempts, [item('three-a2', { status: 'processing', fraction: 0.74 }), item('one-a1', { status: 'done', fraction: 1 })])
    expect(p.line).toBe('1 clip processing on this device')
    expect(p.percent).toBe(87)
    expect(p.active).toBe('Attempt 2 · 74%')
    expect(p.waiting).toBe(0)
  })
  it('says what is waiting when nothing runs, and when all is done', () => {
    expect(processingSummary(attempts, []).line).toBe('1 clip is waiting. Choose its file again to process it on this device.')
    expect(processingSummary(attempts, []).percent).toBeNull()
    expect(processingSummary(one.a, []).line).toBe('Nothing in the queue. 3 of 3 clips processed.')
  })
})

describe('account summary', () => {
  it('counts practice days from dashboardSummary', () => {
    const summary = accountSummary(sessions, attempts, NOW)
    expect([summary.sessions, summary.attempts, summary.attemptsProcessed]).toEqual([3, 7, 6])
    expect(practiceLine(summary, NOW)).toBe('Practice recorded on 2 of the last 14 days · last on Nov 11')
  })
})

describe('researcher view', () => {
  const s1 = session('r1', { subject_code: 'S02', created_at: '2026-11-10T10:00:00Z' })
  const s2 = session('r2', { subject_code: 'S01', created_at: '2026-11-11T10:00:00Z' })
  const rows = [
    attempt('r2-1', s2, 1, { clip_name: 'folder/S01_C01.mp4' }, metrics('r2-1', { trunk_inclination_deg: 4 })),
    attempt('r2-2', s2, 2, {}, metrics('r2-2', {})),
    attempt('r1-1', s1, 1, { status: 'failed', error: 'Clip shorter than 2 s.' }),
    attempt('r1-2', s1, 2, { status: 'queued' }),
    attempt('r1-3', s1, 3, {}, metrics('r1-3', { trunk_inclination_deg: 4 }, { trunk_inclination_deg: 'low' })),
  ]

  it('counts the study', () => {
    const p = studyProgress([s2, s1], rows, undefined, NOW)
    expect(p).toMatchObject({ total: 5, done: 3, processing: 0, queued: 1, failed: 1, flagged: 2, subjects: 2, sessions: 2, percent: 60 })
    expect(p.lastProcessed).toBe('2026-11-01T16:00:00Z')
  })

  it('lists system issues only: failed first, then no tracking and low confidence', () => {
    const items = attentionItems(rows)
    expect(items.map((i) => [i.code, i.status, i.action])).toEqual([
      ['S02', 'Failed', 'Retry'],
      ['S01', 'Not seen', 'Review'],
      ['S02', 'Low camera visibility', 'Review'],
    ])
    expect(items[0].reason).toBe('Clip shorter than 2 s.')
    expect(items[1].reason).toBe('The landmarks this needs weren’t tracked during the phase.')
    expect(items[2].reason).toBe('Low camera visibility: Torso lean.')
  })

  it('orders subjects by code and reports counts, not measurements', () => {
    expect(subjectProgress(rows).map((s) => [s.code, s.label])).toEqual([
      ['S01', '2 / 2'],
      ['S02', '1 / 3'],
    ])
  })

  it('derives recent activity from the rows', () => {
    const events = recentActivity([s2, s1], rows, [note('n1', 'r2-1', '2026-11-12T09:00:00Z')])
    expect(events.map((e) => e.what)).toEqual([
      'Practice notes written for S01 · attempt 1.',
      '2 clips imported for S01 · Relevé balance.',
      '3 clips imported for S02 · Relevé balance.',
      '2 clips processed for S01 · Relevé balance.',
      '1 clip processed for S02 · Relevé balance, 1 failed.',
    ])
  })
})
