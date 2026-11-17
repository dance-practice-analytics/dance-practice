import { describe, expect, it } from 'vitest'
import type { AttemptMetricsRow, AttemptRow, AttemptStatus, CameraView, ConfidenceLevel, MovementType, SessionRow } from '../data/schema'
import type { MetricKey } from '../metrics/types'
import { METRIC_CATALOG, METRIC_KEYS, formatDifference, formatValue, metricsForMovement } from './catalog'
import { NO_DIFFERENCE_TEXT, compareAttempts, differenceSentence, notComparedSentence } from './compare'
import type { AttemptInput, NotCompared, NotComparedCode, Side } from './compare'
import { NEEDS_TWO_SESSIONS_TEXT, changeBetweenSessions, exclusionText, gapText, pickView, progressSeries } from './progress'
import type { ExclusionCode, GapCode, ProgressSession } from './progress'
import { dashboardSummary } from './summary'
import { localDay, median } from './util'

// ---------- synthetic rows ----------

const OWNER = 'owner-1'

function session(id: string, over: Partial<SessionRow> = {}): SessionRow {
  return {
    id,
    owner_id: OWNER,
    subject_id: null,
    movement_type: 'releve_balance',
    title: null,
    recorded_on: null,
    camera_view: 'front',
    note: null,
    created_at: '2026-11-01T15:00:00Z',
    ...over,
  }
}

function attempt(id: string, sessionId: string, over: Partial<AttemptRow> = {}): AttemptRow {
  return {
    id,
    owner_id: OWNER,
    session_id: sessionId,
    source: 'user_upload',
    label: null,
    clip_name: `${id}.mp4`,
    clip_number: null,
    note: null,
    video_path: null,
    video_sha256: null,
    duration_s: 8,
    fps: 30,
    status: 'done',
    error: null,
    is_reference: false,
    trim_start_s: null,
    trim_end_s: null,
    created_at: '2026-11-01T15:05:00Z',
    ...over,
  }
}

type Values = Partial<Record<MetricKey, number | null>>

function metricsRow(attemptId: string, values: Values, over: Partial<AttemptMetricsRow> = {}, levels: Partial<Record<MetricKey, ConfidenceLevel>> = {}): AttemptMetricsRow {
  const confidence: Record<string, { level: ConfidenceLevel; score: number; reason?: string }> = {}
  for (const key of METRIC_KEYS) {
    const v = values[key] ?? null
    confidence[key] = v === null ? { level: 'low', score: 0, reason: 'no_valid_frames' } : { level: levels[key] ?? 'high', score: levels[key] === 'low' ? 0.3 : 0.9 }
  }
  return {
    attempt_id: attemptId,
    owner_id: OWNER,
    movement: 'releve_balance',
    trunk_inclination_deg: null,
    pelvis_ankle_offset_norm: null,
    balance_duration_s: null,
    knee_tracking_dev_deg: null,
    turn_count: null,
    phases: [],
    confidence,
    algorithm_version: 'test-1',
    computed_at: '2026-11-01T15:06:00Z',
    ...values,
    ...over,
  }
}

function input(id: string, values: Values | null, opts: { movement?: MovementType; view?: CameraView | null; levels?: Partial<Record<MetricKey, ConfidenceLevel>> } = {}): AttemptInput {
  const movement = opts.movement ?? 'releve_balance'
  const s = session(`s-${id}`, { movement_type: movement, camera_view: opts.view === undefined ? 'front' : opts.view })
  return { attempt: attempt(id, s.id), metrics: values ? metricsRow(id, values, { movement }, opts.levels) : null, session: s }
}

const row = (c: ReturnType<typeof compareAttempts>, key: MetricKey) => c.rows.find((r) => r.metric === key)!

// ---------- catalogue ----------

describe('catalog', () => {
  it('keys are the attempt_metrics columns and turn count is pirouette only', () => {
    expect(METRIC_KEYS).toEqual(['trunk_inclination_deg', 'pelvis_ankle_offset_norm', 'balance_duration_s', 'knee_tracking_dev_deg', 'turn_count'])
    expect(metricsForMovement('releve_balance')).not.toContain('turn_count')
    expect(metricsForMovement('pirouette')).toContain('turn_count')
  })

  it('formats values and signed differences, never -0 and never 0 for a gap', () => {
    expect(formatValue('trunk_inclination_deg', 4.24)).toBe('4.2°')
    expect(formatValue('balance_duration_s', 3.44)).toBe('3.4 s')
    expect(formatValue('pelvis_ankle_offset_norm', 0.056)).toBe('6%')
    expect(formatValue('trunk_inclination_deg', -0.01)).toBe('0.0°')
    expect(formatValue('trunk_inclination_deg', null)).toBe('—')
    expect(formatDifference('trunk_inclination_deg', -2.1)).toBe('−2.1°')
    expect(formatDifference('balance_duration_s', 0.4)).toBe('+0.4 s')
    expect(formatDifference('balance_duration_s', 0)).toBe('0.0 s')
    expect(formatDifference('balance_duration_s', null)).toBe('—')
  })
})

// ---------- compare ----------

describe('compareAttempts', () => {
  it('gives b − a with unit, decimals and a neutral sentence', () => {
    const c = compareAttempts(
      input('a', { trunk_inclination_deg: 6.3, pelvis_ankle_offset_norm: 0.05, balance_duration_s: 3.1, knee_tracking_dev_deg: 8 }),
      input('b', { trunk_inclination_deg: 4.2, pelvis_ankle_offset_norm: 0.09, balance_duration_s: 3.5, knee_tracking_dev_deg: 8 }),
    )
    expect(c.comparable).toBe(true)
    expect(c.movement).toBe('releve_balance')
    expect(c.rows.map((r) => r.metric)).toEqual(metricsForMovement('releve_balance'))

    const trunk = row(c, 'trunk_inclination_deg')
    expect(trunk).toMatchObject({ comparable: true, reason: null, difference: -2.1, differenceText: '−2.1°', direction: 'less', sentence: 'B is 2.1° less lean' })
    expect(trunk.a).toMatchObject({ value: 6.3, text: '6.3°', confidence: 'high' })
    expect(row(c, 'pelvis_ankle_offset_norm')).toMatchObject({ difference: 0.04, differenceText: '+4%', sentence: 'B is 4% further to the side' })
    expect(row(c, 'balance_duration_s')).toMatchObject({ difference: 0.4, differenceText: '+0.4 s', sentence: 'B is 0.4 s longer' })
    expect(row(c, 'knee_tracking_dev_deg')).toMatchObject({ difference: 0, direction: 'same', sentence: NO_DIFFERENCE_TEXT })
  })

  it('takes the difference of the rounded values, so the table adds up', () => {
    // Shown as 4.3° and 2.1°: the difference is 2.2°, not the 2.1° of the raw values.
    const c = compareAttempts(input('a', { trunk_inclination_deg: 4.26 }), input('b', { trunk_inclination_deg: 2.14 }))
    expect(row(c, 'trunk_inclination_deg')).toMatchObject({ difference: -2.2, sentence: 'B is 2.2° less lean' })
    // Both shown as 4.2°.
    const same = compareAttempts(input('a', { trunk_inclination_deg: 4.21 }), input('b', { trunk_inclination_deg: 4.24 }))
    expect(row(same, 'trunk_inclination_deg')).toMatchObject({ comparable: true, difference: 0, sentence: 'No difference at this precision' })
  })

  it('uses the labels it is given', () => {
    const c = compareAttempts(input('a', { balance_duration_s: 3 }), input('b', { balance_duration_s: 2.5 }), { a: 'Attempt 1', b: 'Attempt 3' })
    expect(row(c, 'balance_duration_s').sentence).toBe('Attempt 3 is 0.5 s shorter')
  })

  it('a null value is not compared, keeps the null and carries the reason', () => {
    const c = compareAttempts(input('a', { trunk_inclination_deg: 5 }), input('b', { trunk_inclination_deg: null }))
    const r = row(c, 'trunk_inclination_deg')
    expect(r.comparable).toBe(false)
    expect(r.reason).toEqual({ code: 'no_value', side: 'b', nullReason: { b: 'no_valid_frames' } })
    expect(r.difference).toBeNull()
    expect(r.differenceText).toBe('—')
    expect(r.b).toMatchObject({ value: null, text: '—', confidence: null })
    expect(r.sentence).toBe('Not compared: no value in B')
    expect(row(c, 'balance_duration_s').reason).toMatchObject({ code: 'no_value', side: 'both' })
  })

  it('low confidence on either side is not compared but the values stay visible', () => {
    const c = compareAttempts(
      input('a', { trunk_inclination_deg: 5, balance_duration_s: 3 }),
      input('b', { trunk_inclination_deg: 4, balance_duration_s: 2 }, { levels: { trunk_inclination_deg: 'low' } }),
    )
    const r = row(c, 'trunk_inclination_deg')
    expect(r).toMatchObject({ comparable: false, reason: { code: 'low_confidence', side: 'b' }, difference: null, sentence: 'Not compared: tracking was low in B' })
    expect(r.b).toMatchObject({ value: 4, confidence: 'low' })
    expect(row(c, 'balance_duration_s').comparable).toBe(true)
  })

  it('a value without a stored confidence counts as low', () => {
    const b = input('b', { trunk_inclination_deg: 4 })
    b.metrics!.confidence = {}
    const c = compareAttempts(input('a', { trunk_inclination_deg: 5 }), b)
    expect(row(c, 'trunk_inclination_deg').reason).toEqual({ code: 'low_confidence', side: 'b' })
  })

  it('an attempt without a metrics row is not processed', () => {
    const c = compareAttempts(input('a', null), input('b', { trunk_inclination_deg: 4 }))
    expect(c.comparable).toBe(true)
    expect(row(c, 'trunk_inclination_deg')).toMatchObject({ comparable: false, reason: { code: 'not_processed', side: 'a' }, sentence: 'Not compared: A has no measurements yet' })
  })

  it('different movements are never compared', () => {
    const c = compareAttempts(input('a', { trunk_inclination_deg: 5 }), input('b', { trunk_inclination_deg: 4, turn_count: 1 }, { movement: 'pirouette' }))
    expect(c).toMatchObject({ comparable: false, movement: null, reason: { code: 'different_movement' } })
    expect(c.rows).toHaveLength(METRIC_KEYS.length)
    expect(c.rows.every((r) => !r.comparable && r.difference === null && r.reason?.code === 'different_movement')).toBe(true)
  })

  it('different known camera views are not compared; an unknown view does not block', () => {
    const a = input('a', { trunk_inclination_deg: 5 })
    const side = compareAttempts(a, input('b', { trunk_inclination_deg: 4 }, { view: 'side' }))
    expect(side).toMatchObject({ comparable: false, reason: { code: 'different_camera_view' }, cameraViews: { a: 'front', b: 'side' } })
    expect(row(side, 'trunk_inclination_deg').sentence).toBe('Not compared: the two attempts were filmed from different camera views')

    const unknown = compareAttempts(a, input('b', { trunk_inclination_deg: 4 }, { view: null }))
    expect(unknown.comparable).toBe(true)
    expect(row(unknown, 'trunk_inclination_deg').difference).toBe(-1)
  })
})

// ---------- medians and days ----------

describe('median', () => {
  it('is the middle value, or the mean of the two middle values', () => {
    expect(median([])).toBeNull()
    expect(median([3])).toBe(3)
    expect(median([5, 1, 3])).toBe(3)
    expect(median([4, 1, 3, 2])).toBe(2.5)
  })
})

describe('localDay', () => {
  it('depends on the time zone for a timestamp, not for a date', () => {
    expect(localDay('2026-11-10T03:30:00Z', 'America/New_York')).toBe('2026-11-09')
    expect(localDay('2026-11-10T03:30:00Z', 'UTC')).toBe('2026-11-10')
    expect(localDay('2026-11-10T20:30:00Z', 'Asia/Tokyo')).toBe('2026-11-11')
    expect(localDay('2026-11-10', 'Asia/Tokyo')).toBe('2026-11-10')
    expect(localDay('not a date')).toBeNull()
  })
})

// ---------- progress ----------

const TRUNK = 'trunk_inclination_deg' as const

function world() {
  const sessions = [
    session('s1', { recorded_on: '2026-11-03' }),
    session('s2', { recorded_on: '2026-11-07' }),
    session('s3', { recorded_on: '2026-11-12' }),
    session('s-side', { recorded_on: '2026-11-08', camera_view: 'side' }),
    session('s-noview', { recorded_on: '2026-11-09', camera_view: null }),
    session('s-pir', { recorded_on: '2026-11-10', movement_type: 'pirouette' }),
    session('s-empty', { recorded_on: '2026-11-11' }),
  ]
  const attempts = [
    attempt('a1', 's1', { created_at: '2026-11-03T15:00:00Z' }),
    attempt('a2', 's1', { created_at: '2026-11-03T15:01:00Z' }),
    attempt('a3', 's1', { created_at: '2026-11-03T15:02:00Z' }),
    attempt('a4', 's1', { created_at: '2026-11-03T15:03:00Z' }),
    attempt('b1', 's2', { created_at: '2026-11-07T15:00:00Z' }),
    attempt('b2', 's2', { created_at: '2026-11-07T15:01:00Z' }),
    attempt('b3', 's2', { created_at: '2026-11-07T15:02:00Z', status: 'failed' }),
    attempt('b4', 's2', { created_at: '2026-11-07T15:03:00Z', status: 'processing' }),
    attempt('b5', 's2', { created_at: '2026-11-07T15:04:00Z' }),
    attempt('c1', 's3', { created_at: '2026-11-12T15:00:00Z' }),
    attempt('c2', 's3', { created_at: '2026-11-12T15:01:00Z' }),
    attempt('d1', 's-side', { created_at: '2026-11-08T15:00:00Z' }),
    attempt('e1', 's-noview', { created_at: '2026-11-09T15:00:00Z' }),
    attempt('p1', 's-pir', { created_at: '2026-11-10T15:00:00Z' }),
  ]
  const metrics = [
    metricsRow('a1', { [TRUNK]: 6 }),
    metricsRow('a2', { [TRUNK]: 8 }),
    metricsRow('a3', { [TRUNK]: 7 }),
    metricsRow('a4', { [TRUNK]: 5 }),
    metricsRow('b1', { [TRUNK]: 5 }),
    metricsRow('b2', { [TRUNK]: null }),
    metricsRow('b5', { [TRUNK]: 20 }, {}, { [TRUNK]: 'low' }),
    metricsRow('c1', { [TRUNK]: 4.4 }),
    metricsRow('c2', { [TRUNK]: 5.2 }),
    metricsRow('d1', { [TRUNK]: 1 }),
    metricsRow('e1', { [TRUNK]: 2 }),
    metricsRow('p1', { [TRUNK]: 3, turn_count: 1.25 }, { movement: 'pirouette' }),
  ]
  return { sessions, attempts, metrics }
}

describe('progressSeries', () => {
  it('gives one point per attempt, grouped by session, oldest first, with the session median', () => {
    const { sessions, attempts, metrics } = world()
    const p = progressSeries([...sessions].reverse(), [...attempts].reverse(), metrics, { movement: 'releve_balance', metric: TRUNK })
    expect(p.state).toBe('ready')
    expect(p.cameraView).toBe('front')
    expect(p.sessions.map((s) => s.sessionId)).toEqual(['s1', 's2', 's3'])
    expect(p.sessions.map((s) => s.points.map((x) => x.attemptId))).toEqual([['a1', 'a2', 'a3', 'a4'], ['b1', 'b2', 'b3', 'b4', 'b5'], ['c1', 'c2']])
    expect(p.points).toHaveLength(11)
    // Even count: mean of 6 and 7.
    expect(p.sessions[0]).toMatchObject({ median: 6.5, medianText: '6.5°', countedValues: 4, date: '2026-11-03' })
    expect(p.sessions[2].median).toBeCloseTo(4.8)
  })

  it('keeps gaps as gaps with a reason and leaves low-confidence values out of the median', () => {
    const { sessions, attempts, metrics } = world()
    const s2 = progressSeries(sessions, attempts, metrics, { movement: 'releve_balance', metric: TRUNK }).sessions[1]
    const byId = Object.fromEntries(s2.points.map((x) => [x.attemptId, x]))
    expect(byId.b2).toMatchObject({ value: null, gap: { code: 'no_value', nullReason: 'no_valid_frames' }, counted: false })
    expect(byId.b3).toMatchObject({ value: null, gap: { code: 'processing_failed' } })
    expect(byId.b4).toMatchObject({ value: null, gap: { code: 'not_processed' } })
    expect(byId.b5).toMatchObject({ value: 20, gap: null, confidence: 'low', lowConfidence: true, counted: false })
    expect(s2.points.some((x) => x.value === 0)).toBe(false)
    expect(s2).toMatchObject({ median: 5, countedValues: 1 })
  })

  it('does not mix movements or camera views and reports what it left out', () => {
    const { sessions, attempts, metrics } = world()
    const p = progressSeries(sessions, attempts, metrics, { movement: 'releve_balance', metric: TRUNK })
    const reasons = Object.fromEntries(p.excluded.map((e) => [e.sessionId, e.reason]))
    expect(reasons).toEqual({
      's-side': 'different_camera_view',
      's-noview': 'unknown_camera_view',
      's-pir': 'different_movement',
      's-empty': 'no_attempts',
    })
    expect(p.points.map((x) => x.attemptId)).not.toContain('d1')

    const side = progressSeries(sessions, attempts, metrics, { movement: 'releve_balance', metric: TRUNK, cameraView: 'side' })
    expect(side.sessions.map((s) => s.sessionId)).toEqual(['s-side'])
    expect(side.state).toBe('needs_two_sessions')
    expect(side.excluded.filter((e) => e.reason === 'different_camera_view').map((e) => e.sessionId)).toEqual(['s1', 's2', 's3'])
  })

  it('filters by date range and reports the sessions outside it', () => {
    const { sessions, attempts, metrics } = world()
    const p = progressSeries(sessions, attempts, metrics, { movement: 'releve_balance', metric: TRUNK, from: '2026-11-05', to: '2026-11-12' })
    expect(p.sessions.map((s) => s.sessionId)).toEqual(['s2', 's3'])
    expect(p.excluded.find((e) => e.sessionId === 's1')?.reason).toBe('outside_date_range')
  })

  it('uses sessions without a recorded view only when no session has one', () => {
    const sessions = [session('u1', { recorded_on: '2026-11-01', camera_view: null }), session('u2', { recorded_on: '2026-11-02', camera_view: null })]
    const attempts = [attempt('x1', 'u1'), attempt('x2', 'u2')]
    const metrics = [metricsRow('x1', { [TRUNK]: 3 }), metricsRow('x2', { [TRUNK]: 4 })]
    const p = progressSeries(sessions, attempts, metrics, { movement: 'releve_balance', metric: TRUNK })
    expect(p).toMatchObject({ cameraView: 'unknown', state: 'ready', excluded: [] })
  })

  it('picks the view with the most sessions, the most recent one on a tie', () => {
    expect(pickView([])).toBeNull()
    expect(pickView([{ camera_view: 'front', date: '2026-11-01' }, { camera_view: 'side', date: '2026-11-02' }, { camera_view: 'front', date: '2026-11-03' }])).toBe('front')
    expect(pickView([{ camera_view: 'front', date: '2026-11-01' }, { camera_view: 'side', date: '2026-11-02' }])).toBe('side')
    expect(pickView([{ camera_view: null, date: '2026-11-01' }])).toBe('unknown')
  })

  it('reports a metric that is not measured for the movement, and an empty history', () => {
    const { sessions, attempts, metrics } = world()
    expect(progressSeries(sessions, attempts, metrics, { movement: 'releve_balance', metric: 'turn_count' }).state).toBe('not_applicable')
    const none = progressSeries([], [], [], { movement: 'pirouette', metric: 'turn_count' })
    expect(none).toMatchObject({ state: 'no_data', cameraView: null, sessions: [], change: { state: 'needs_two_sessions', text: NEEDS_TWO_SESSIONS_TEXT } })
  })

  it('a metrics row of another movement inside the session is a gap', () => {
    const sessions = [session('s1', { recorded_on: '2026-11-03' })]
    const attempts = [attempt('a1', 's1')]
    const metrics = [metricsRow('a1', { [TRUNK]: 3 }, { movement: 'pirouette' })]
    const p = progressSeries(sessions, attempts, metrics, { movement: 'releve_balance', metric: TRUNK })
    expect(p.points[0]).toMatchObject({ value: null, gap: { code: 'different_movement' } })
    expect(p.state).toBe('no_data')
  })

  it('dates a session by recorded_on, else by the local day of its first attempt', () => {
    const sessions = [session('s1', { recorded_on: null }), session('s2', { recorded_on: '2026-11-08' })]
    const attempts = [
      attempt('late', 's1', { created_at: '2026-11-10T05:00:00Z' }),
      attempt('first', 's1', { created_at: '2026-11-10T03:30:00Z' }),
      attempt('other', 's2', { created_at: '2026-11-10T03:30:00Z' }),
    ]
    const opts = { movement: 'releve_balance', metric: TRUNK } as const
    const ny = progressSeries(sessions, attempts, [], { ...opts, timeZone: 'America/New_York' })
    expect(ny.sessions.map((s) => [s.sessionId, s.date])).toEqual([['s2', '2026-11-08'], ['s1', '2026-11-09']])
    expect(ny.sessions[1].points.map((x) => x.attemptId)).toEqual(['first', 'late'])
    const utc = progressSeries(sessions, attempts, [], { ...opts, timeZone: 'UTC' })
    expect(utc.sessions.map((s) => s.date)).toEqual(['2026-11-08', '2026-11-10'])
  })
})

describe('changeBetweenSessions', () => {
  it('compares the first and the latest session median in neutral words', () => {
    const { sessions, attempts, metrics } = world()
    const p = progressSeries(sessions, attempts, metrics, { movement: 'releve_balance', metric: TRUNK })
    expect(p.change).toMatchObject({
      state: 'ready',
      first: { sessionId: 's1', median: 6.5 },
      latest: { sessionId: 's3' },
      difference: -1.7,
      direction: 'less',
      text: 'Median on 2026-11-12 is 1.7° less lean than on 2026-11-03',
    })
  })

  it('needs two sessions with a value', () => {
    const { sessions, attempts, metrics } = world()
    const p = progressSeries(sessions, attempts, metrics, { movement: 'releve_balance', metric: TRUNK, to: '2026-11-03' })
    expect(p.state).toBe('needs_two_sessions')
    expect(p.change).toMatchObject({ state: 'needs_two_sessions', first: { sessionId: 's1' }, latest: null, difference: null, text: NEEDS_TWO_SESSIONS_TEXT })
  })

  it('says so when the medians are equal at the metric precision', () => {
    const mk = (id: string, date: string, m: number | null): ProgressSession => ({ sessionId: id, title: null, date, cameraView: 'front', points: [], median: m, medianText: '', countedValues: m === null ? 0 : 1 })
    const c = changeBetweenSessions([mk('s1', '2026-11-01', 4.21), mk('gap', '2026-11-02', null), mk('s3', '2026-11-03', 4.24)], TRUNK)
    expect(c).toMatchObject({ state: 'ready', difference: 0, direction: 'same', text: 'No difference at this precision between 2026-11-01 and 2026-11-03' })
  })
})

// ---------- summary ----------

describe('dashboardSummary', () => {
  it('counts attempts, sessions and statuses', () => {
    const { sessions, attempts, metrics } = world()
    const s = dashboardSummary(sessions, attempts, metrics, { now: new Date('2026-11-15T17:00:00Z'), timeZone: 'America/New_York' })
    expect(s.sessions).toBe(7)
    expect(s.attempts).toBe(14)
    expect(s.attemptsByStatus).toEqual({ queued: 0, processing: 1, done: 12, failed: 1 } satisfies Record<AttemptStatus, number>)
    expect(s.attemptsProcessed).toBe(12)
    expect(s.lastPracticeDate).toBe('2026-11-12')
  })

  it('builds the calendar strip for the last N days ending today', () => {
    const { sessions, attempts, metrics } = world()
    const s = dashboardSummary(sessions, attempts, metrics, { now: new Date('2026-11-15T17:00:00Z'), days: 7, timeZone: 'America/New_York' })
    expect(s.practiceDays.map((d) => d.date)).toEqual(['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15'])
    expect(s.practiceDays.map((d) => d.attempts)).toEqual([1, 1, 0, 2, 0, 0, 0])
    expect(s.practiceDayCount).toBe(3)
  })

  it('places attempts and today on local days', () => {
    const sessions = [session('s1', { recorded_on: null }), session('s2', { recorded_on: '2026-11-13' })]
    const attempts = [
      attempt('a1', 's1', { created_at: '2026-11-14T03:30:00Z' }),
      attempt('a2', 's1', { created_at: '2026-11-14T15:00:00Z' }),
      // recorded_on wins over created_at.
      attempt('a3', 's2', { created_at: '2026-11-15T01:00:00Z' }),
    ]
    const now = new Date('2026-11-15T02:00:00Z')
    const ny = dashboardSummary(sessions, attempts, [], { now, days: 3, timeZone: 'America/New_York' })
    expect(ny.practiceDays).toEqual([{ date: '2026-11-12', attempts: 0 }, { date: '2026-11-13', attempts: 2 }, { date: '2026-11-14', attempts: 1 }])
    expect(ny.lastPracticeDate).toBe('2026-11-14')
    const tokyo = dashboardSummary(sessions, attempts, [], { now, days: 3, timeZone: 'Asia/Tokyo' })
    expect(tokyo.practiceDays).toEqual([{ date: '2026-11-13', attempts: 1 }, { date: '2026-11-14', attempts: 1 }, { date: '2026-11-15', attempts: 1 }])
    expect(tokyo.lastPracticeDate).toBe('2026-11-15')
  })

  it('gives the latest session median per metric, null when there is none', () => {
    const { sessions, attempts, metrics } = world()
    const s = dashboardSummary(sessions, attempts, metrics, { now: new Date('2026-11-15T17:00:00Z'), timeZone: 'UTC' })
    const find = (movement: MovementType, metric: MetricKey) => s.latestMedians.find((m) => m.movement === movement && m.metric === metric)!
    expect(s.latestMedians).toHaveLength(metricsForMovement('releve_balance').length + metricsForMovement('pirouette').length)
    expect(find('releve_balance', TRUNK)).toMatchObject({ text: '4.8°', sessionId: 's3', date: '2026-11-12', cameraView: 'front', countedValues: 2 })
    expect(find('releve_balance', 'balance_duration_s')).toMatchObject({ median: null, text: '—', sessionId: null, date: null })
    expect(find('pirouette', 'turn_count')).toMatchObject({ median: 1.25, text: '1.25 turns', sessionId: 's-pir' })
  })

  it('is all zeros and nulls with no data', () => {
    const s = dashboardSummary([], [], [], { now: new Date('2026-11-15T17:00:00Z'), timeZone: 'UTC' })
    expect(s).toMatchObject({ sessions: 0, attempts: 0, attemptsProcessed: 0, lastPracticeDate: null, practiceDayCount: 0, latestMedians: [] })
    expect(s.practiceDays).toHaveLength(14)
  })
})

// ---------- neutral copy ----------

describe('neutral copy', () => {
  const BANNED = ['better', 'worse', 'improve', 'good', 'bad', 'correct', 'wrong', 'score', 'perfect', 'poor']

  function everySentence(): string[] {
    const out: string[] = []
    const sides: Side[] = ['a', 'b', 'both']
    const codes: NotComparedCode[] = ['different_movement', 'different_camera_view', 'not_processed', 'no_value', 'low_confidence']
    for (const code of codes) {
      for (const side of sides) out.push(notComparedSentence({ code, side } satisfies NotCompared))
      out.push(notComparedSentence({ code }))
    }
    for (const key of METRIC_KEYS) {
      const info = METRIC_CATALOG[key]
      out.push(info.label, info.unit, info.description, info.lessWord, info.moreWord)
      for (const d of [-1.23, 0, 1.23]) {
        out.push(differenceSentence(key, d), formatDifference(key, d))
        const mk = (id: string, m: number): ProgressSession => ({ sessionId: id, title: null, date: '2026-11-01', cameraView: 'front', points: [], median: m, medianText: '', countedValues: 1 })
        out.push(changeBetweenSessions([mk('s1', 5), mk('s2', 5 + d)], key).text)
      }
      out.push(changeBetweenSessions([], key).text)
    }
    const exclusions: ExclusionCode[] = ['different_movement', 'different_camera_view', 'unknown_camera_view', 'outside_date_range', 'no_attempts', 'no_date']
    out.push(...exclusions.map(exclusionText))
    const gaps: GapCode[] = ['not_processed', 'processing_failed', 'different_movement', 'no_value']
    out.push(...gaps.map((code) => gapText({ code })))

    // Sentences from real comparisons, including every reason path.
    const a = input('a', { trunk_inclination_deg: 6.3, pelvis_ankle_offset_norm: 0.05, balance_duration_s: 3.1, knee_tracking_dev_deg: null })
    const pairs: [AttemptInput, AttemptInput][] = [
      [a, input('b', { trunk_inclination_deg: 4.2, pelvis_ankle_offset_norm: 0.09, balance_duration_s: 3.1, knee_tracking_dev_deg: 2 }, { levels: { trunk_inclination_deg: 'low' } })],
      [a, input('b', null)],
      [a, input('b', { turn_count: 2 }, { movement: 'pirouette' })],
      [a, input('b', { trunk_inclination_deg: 1 }, { view: 'diagonal' })],
    ]
    for (const [x, y] of pairs) out.push(...compareAttempts(x, y).rows.map((r) => r.sentence))
    return out
  }

  it('no sentence the builders can produce uses a grading word', () => {
    const sentences = everySentence()
    expect(sentences.length).toBeGreaterThan(80)
    for (const s of sentences) {
      const lower = s.toLowerCase()
      for (const word of BANNED) expect(lower.includes(word), `"${s}" contains "${word}"`).toBe(false)
    }
  })

  it('the scan itself catches a grading word', () => {
    expect(BANNED.some((w) => 'B is 2.1° better'.includes(w))).toBe(true)
  })
})
