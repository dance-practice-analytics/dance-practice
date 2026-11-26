import { describe, expect, it } from 'vitest'
import { buildExportDocument, type ExportRows } from '../../../data/exportData'
import type { AttemptMetricsRow, AttemptStatus, CameraView, MovementType } from '../../../data/schema'
import type { AttemptView } from '../../data'
import { median, subjectAggregates, subjectSummaryColumns, subjectSummaryCsv } from './aggregate'
import { datasetCsv, datasetCsvColumns } from './csv'
import { NO_CODE, PLANNED_TOTAL, buildGrid, cellKind, matchesFilter, rowSummary } from './grid'

// Synthetic rows only.

const conf = (level: string, score = 0.9) => ({ level, score })

function metrics(id: string, levels: Record<string, string>, values: Partial<AttemptMetricsRow> = {}): AttemptMetricsRow {
  return {
    attempt_id: id,
    owner_id: 'u',
    movement: 'releve_balance',
    trunk_inclination_deg: 4.2,
    pelvis_ankle_offset_norm: 0.06,
    balance_duration_s: 3.4,
    knee_tracking_dev_deg: 7.1,
    turn_count: null,
    phases: [{ phase: 'hold', start: 1, end: 4 }],
    confidence: Object.fromEntries(Object.entries(levels).map(([k, l]) => [k, conf(l)])) as AttemptMetricsRow['confidence'],
    algorithm_version: 'test-1',
    computed_at: '2026-11-15T10:00:00Z',
    ...values,
  }
}

const ALL_HIGH = { trunk_inclination_deg: 'high', pelvis_ankle_offset_norm: 'high', balance_duration_s: 'high', knee_tracking_dev_deg: 'high' }

interface Spec {
  id: string
  code: string | null
  movement?: MovementType
  status?: AttemptStatus
  session?: string
  sessionAt?: string
  number?: number
  view?: CameraView | null
  source?: 'study_dataset' | 'user_upload'
  metrics?: AttemptMetricsRow | null
  error?: string | null
}

function attempt(s: Spec): AttemptView {
  const movement = s.movement ?? 'releve_balance'
  const session = s.session ?? `ses-${s.code}-${movement}`
  return {
    id: s.id,
    owner_id: 'u',
    session_id: session,
    source: s.source ?? 'study_dataset',
    label: null,
    clip_name: `${s.id}.mp4`,
    clip_number: null,
    note: null,
    video_path: null,
    video_sha256: null,
    duration_s: 6,
    fps: 30,
    status: s.status ?? 'done',
    error: s.error ?? null,
    is_reference: false,
    trim_start_s: null,
    trim_end_s: null,
    created_at: '2026-11-15T09:00:00Z',
    number: s.number ?? 1,
    metrics: s.metrics === undefined ? (s.status && s.status !== 'done' ? null : metrics(s.id, ALL_HIGH)) : s.metrics,
    session: {
      id: session,
      owner_id: 'u',
      subject_id: s.code ? `sub-${s.code}` : null,
      movement_type: movement,
      title: null,
      recorded_on: '2026-11-04',
      camera_view: s.view === undefined ? 'side' : s.view,
      note: null,
      created_at: s.sessionAt ?? '2026-11-15T08:00:00Z',
      subject_code: s.code,
      attempt_count: 1,
    },
  }
}

describe('cellKind', () => {
  it('takes the lowest confidence among the values that were measured', () => {
    expect(cellKind(attempt({ id: 'a', code: 'S01' }))).toBe('done-high')
    expect(cellKind(attempt({ id: 'a', code: 'S01', metrics: metrics('a', { ...ALL_HIGH, balance_duration_s: 'medium' }) }))).toBe('done-med')
    expect(cellKind(attempt({ id: 'a', code: 'S01', metrics: metrics('a', { ...ALL_HIGH, balance_duration_s: 'medium', knee_tracking_dev_deg: 'low' }) }))).toBe('done-low')
  })

  it('a null value does not count as low; a clip with no values at all is "no tracking"', () => {
    const oneGap = metrics('a', ALL_HIGH, { knee_tracking_dev_deg: null })
    expect(cellKind(attempt({ id: 'a', code: 'S01', metrics: oneGap }))).toBe('done-high')
    const none = metrics('a', {}, { trunk_inclination_deg: null, pelvis_ankle_offset_norm: null, balance_duration_s: null, knee_tracking_dev_deg: null })
    expect(cellKind(attempt({ id: 'a', code: 'S01', metrics: none }))).toBe('done-none')
    expect(cellKind(attempt({ id: 'a', code: 'S01', metrics: null }))).toBe('done-none')
  })

  it('a stale "processing" row counts as queued unless this tab is working on it', () => {
    const a = attempt({ id: 'a', code: 'S01', status: 'processing' })
    expect(cellKind(a)).toBe('queued')
    expect(cellKind(a, new Set(['a']))).toBe('processing')
    expect(cellKind(attempt({ id: 'b', code: 'S01', status: 'failed' }))).toBe('failed')
    expect(cellKind(attempt({ id: 'c', code: 'S01', status: 'queued' }))).toBe('queued')
  })
})

describe('buildGrid', () => {
  const attempts = [
    // Newest session first, as the library gives them.
    attempt({ id: 'p1', code: 'S02', movement: 'pirouette', status: 'failed', error: 'No person found.' }),
    attempt({ id: 'r3', code: 'S01', session: 'ses-late', sessionAt: '2026-11-15T09:30:00Z', status: 'queued' }),
    attempt({ id: 'r1', code: 'S01', session: 'ses-early', number: 1 }),
    attempt({ id: 'r2', code: 'S01', session: 'ses-early', number: 2, view: 'front', metrics: metrics('r2', { ...ALL_HIGH, trunk_inclination_deg: 'low' }) }),
    attempt({ id: 'x1', code: null }),
    attempt({ id: 'mine', code: null, source: 'user_upload' }),
  ]
  const grid = buildGrid(attempts)

  it('has the planned 12 × 15 shape, subjects in code order, with the uncoded row last', () => {
    expect(PLANNED_TOTAL).toBe(180)
    expect(grid.columns).toBe(15)
    expect(grid.groups.map((g) => [g.movement, g.first, g.count])).toEqual([
      ['releve_balance', 1, 10],
      ['pirouette', 11, 5],
    ])
    expect(grid.rows.map((r) => r.code)).toEqual([...Array.from({ length: 12 }, (_, i) => `S${String(i + 1).padStart(2, '0')}`), NO_CODE])
    expect(grid.rows.every((r) => r.cells.length === 15)).toBe(true)
  })

  it('places clips in import order and leaves every other place empty (null, not zero)', () => {
    const s01 = grid.rows[0]
    expect(s01.cells.slice(0, 3).map((c) => c?.attempt.id)).toEqual(['r1', 'r2', 'r3'])
    expect(s01.cells.slice(0, 3).map((c) => c?.clip)).toEqual(['C01', 'C02', 'C03'])
    expect(s01.cells.slice(3).every((c) => c === null)).toBe(true)
    expect([s01.done, s01.clips]).toEqual([2, 3])
    const s02 = grid.rows[1]
    expect(s02.cells[10]?.attempt.id).toBe('p1')
    expect(s02.cells[10]?.clip).toBe('C11')
    expect(s02.cells.filter(Boolean)).toHaveLength(1)
    expect(grid.rows[2].cells.every((c) => c === null)).toBe(true)
    expect([grid.rows[2].done, grid.rows[2].clips]).toEqual([0, 0])
  })

  it('counts study clips by status and leaves personal clips out', () => {
    expect(grid.counts).toEqual({ done: 3, processing: 0, queued: 1, failed: 1, clips: 5 })
    expect(grid.personal).toBe(1)
  })

  it('does not reorder subjects when the measured values change', () => {
    const swapped = attempts.map((a) => (a.metrics ? { ...a, metrics: { ...a.metrics, trunk_inclination_deg: a.id === 'r1' ? 99 : 0.1 } } : a))
    expect(buildGrid(swapped).rows.map((r) => r.code)).toEqual(grid.rows.map((r) => r.code))
    expect(buildGrid([...attempts].reverse()).rows[0].cells.slice(0, 3).map((c) => c?.attempt.id)).toEqual(['r1', 'r2', 'r3'])
  })

  it('widens a group only when a subject has more clips than planned, and lists unplanned codes after S12', () => {
    const many = Array.from({ length: 6 }, (_, i) => attempt({ id: `q${i}`, code: 'S13', movement: 'pirouette', number: i + 1 }))
    const wide = buildGrid(many)
    expect(wide.columns).toBe(16)
    expect(wide.groups[1]).toMatchObject({ first: 11, count: 6 })
    expect(wide.rows.map((r) => r.code).slice(11)).toEqual(['S12', 'S13'])
  })

  it('filters by status group and camera view', () => {
    const [c1, c2, c3] = grid.rows[0].cells
    expect(matchesFilter(c1!, { status: 'all', view: 'all' })).toBe(true)
    expect(matchesFilter(c2!, { status: 'done', view: 'front' })).toBe(true)
    expect(matchesFilter(c1!, { status: 'done', view: 'front' })).toBe(false)
    expect(matchesFilter(c3!, { status: 'done', view: 'all' })).toBe(false)
    expect(matchesFilter(c3!, { status: 'queued', view: 'side' })).toBe(true)
  })

  it('summarizes a row in words', () => {
    expect(rowSummary(grid.rows[0])).toBe('S01: 2 of 3 clips done, 1 queued')
    expect(rowSummary(grid.rows[1])).toBe('S02: 0 of 1 clip done, 1 failed')
    expect(rowSummary(grid.rows[2])).toBe('S03: no clips imported')
  })
})

describe('datasetCsv', () => {
  const rows: ExportRows = {
    subjects: [
      { id: 'sub2', subject_code: 'S02' },
      { id: 'sub1', subject_code: 'S01' },
    ],
    sessions: [
      { id: 'ses2', subject_id: 'sub2', movement_type: 'pirouette', title: 'Typed title, private', recorded_on: '2026-11-05', camera_view: 'front', created_at: '2026-11-15T08:00:00Z' },
      { id: 'ses1', subject_id: 'sub1', movement_type: 'releve_balance', title: null, recorded_on: '2026-11-04', camera_view: 'side', created_at: '2026-11-15T08:10:00Z' },
      { id: 'ses3', subject_id: null, movement_type: 'releve_balance', title: null, recorded_on: null, camera_view: null, created_at: '2026-11-15T08:20:00Z' },
    ],
    attempts: [
      { id: 'b1', session_id: 'ses2', source: 'study_dataset', label: null, clip_name: 'S02_pir_front_11.mp4', duration_s: 5, fps: 30, status: 'queued', error: null, created_at: '2026-11-15T09:00:00Z' },
      { id: 'a2', session_id: 'ses1', source: 'study_dataset', label: 'typed label', clip_name: 'S01_releve_02.mp4', duration_s: 6, fps: 30, status: 'done', error: null, created_at: '2026-11-15T09:02:00Z' },
      { id: 'a1', session_id: 'ses1', source: 'study_dataset', label: null, clip_name: 'S01_releve_01.mp4', duration_s: 6, fps: 30, status: 'done', error: null, created_at: '2026-11-15T09:01:00Z' },
      { id: 'own', session_id: 'ses3', source: 'user_upload', label: null, clip_name: 'me.mp4', duration_s: 6, fps: 30, status: 'done', error: null, created_at: '2026-11-15T09:03:00Z' },
    ],
    keypoints: [],
    metrics: [
      (({ owner_id: _o, ...m }) => m)(
        metrics('a1', { ...ALL_HIGH, knee_tracking_dev_deg: 'low' }, {
          balance_duration_s: null,
          confidence: {
            ...Object.fromEntries(Object.entries({ ...ALL_HIGH, knee_tracking_dev_deg: 'low' }).map(([k, l]) => [k, conf(l, 0.42)])),
            balance_duration_s: { level: 'low', score: 0, reason: 'no_lift_detected' },
          } as unknown as AttemptMetricsRow['confidence'],
        }),
      ),
    ],
    feedback: [],
    consents: [],
  }
  const doc = buildExportDocument(rows, { now: new Date('2026-11-15T12:00:00Z') })
  const clipOf = new Map([
    ['a1', 'C01'],
    ['a2', 'C02'],
    ['b1', 'C11'],
  ])
  const parse = (csv: string) => {
    const [head, ...lines] = csv.trimEnd().split('\r\n')
    const cols = head.split(',')
    return lines.map((l) => Object.fromEntries(l.split(',').map((v, i) => [cols[i], v])))
  }

  it('has one row per study attempt, ordered by subject code then clip, without personal clips', () => {
    const csv = datasetCsv(doc, clipOf, { confidence: true, phases: true })
    const out = parse(csv)
    expect(out.map((r) => [r.subject_code, r.clip, r.attempt_id])).toEqual([
      ['S01', 'C01', 'a1'],
      ['S01', 'C02', 'a2'],
      ['S02', 'C11', 'b1'],
    ])
    expect(csv.endsWith('\r\n')).toBe(true)
  })

  it('writes a missing value as an empty cell with its reason, and keeps a low-confidence value with its flag', () => {
    const [a1, a2, b1] = parse(datasetCsv(doc, clipOf, { confidence: true, phases: true }))
    expect(a1.balance_duration_s).toBe('')
    expect(a1.balance_duration_s_null_reason).toBe('no_lift_detected')
    expect(a1.knee_tracking_dev_deg).toBe('7.1')
    expect(a1.knee_tracking_dev_deg_confidence_level).toBe('low')
    expect(a1.knee_tracking_dev_deg_confidence_score).toBe('0.42')
    expect(a1.turn_count).toBe('')
    expect(a1.turn_count_null_reason).toBe('not_applicable')
    expect([a1.hold_start_s, a1.hold_end_s, a1.prep_start_s]).toEqual(['1', '4', ''])
    // Processed without a metrics row, and never processed: reasons, not zeros.
    expect([a2.trunk_inclination_deg, a2.trunk_inclination_deg_null_reason]).toEqual(['', 'not_processed'])
    expect([b1.turn_count, b1.turn_count_null_reason, b1.attempt_status]).toEqual(['', 'not_processed', 'queued'])
  })

  it('never contains typed text, file names, emails or paths', () => {
    const csv = datasetCsv(doc, clipOf, { confidence: true, phases: true })
    for (const secret of ['Typed title', 'typed label', '.mp4', '@', 'video', 'owner']) expect(csv).not.toContain(secret)
  })

  it('leaves out the optional column groups when they are switched off', () => {
    const lean = datasetCsvColumns({ confidence: false, phases: false })
    expect(lean.some((c) => c.includes('confidence'))).toBe(false)
    expect(lean.some((c) => c.endsWith('_start_s'))).toBe(false)
    expect(lean.slice(0, 3)).toEqual(['subject_code', 'clip', 'movement'])
    const full = datasetCsvColumns({ confidence: true, phases: true })
    expect(full.length).toBe(lean.length + 12 + 12)
    const csv = datasetCsv(doc, clipOf, { confidence: false, phases: false })
    expect(csv.split('\r\n')[0]).toBe(lean.join(','))
  })
})

describe('per-subject summary (FR-3.6.5)', () => {
  const lvl = (level: string) => ({ ...ALL_HIGH, trunk_inclination_deg: level })
  const at = (id: string, code: string | null, trunk: number | null, level = 'high', over: Partial<Spec> = {}) =>
    attempt({ id, code, metrics: metrics(id, lvl(level), { trunk_inclination_deg: trunk }), ...over })

  it('takes the median of a subject’s own values and counts the left-out ones', () => {
    const list = [
      at('a1', 'S02', 4),
      at('a2', 'S02', 6),
      at('a3', 'S02', 5, 'medium'),
      at('a4', 'S02', 30, 'low'),
      at('a5', 'S02', null, 'high'),
      at('b1', 'S01', 2),
      at('b2', 'S01', 3),
      // Not counted: another movement, not processed, a personal clip.
      at('c1', 'S01', 9, 'high', { movement: 'pirouette' }),
      attempt({ id: 'q1', code: 'S01', status: 'queued' }),
      at('p1', 'S01', 50, 'high', { source: 'user_upload' }),
    ]
    const aggs = subjectAggregates(list)
    expect(aggs.map((g) => [g.code, g.movement, g.attempts])).toEqual([
      ['S01', 'releve_balance', 2],
      ['S01', 'pirouette', 1],
      ['S02', 'releve_balance', 5],
    ])
    const trunk = aggs[2].metrics.find((m) => m.metric === 'trunk_inclination_deg')!
    expect(trunk).toEqual({ metric: 'trunk_inclination_deg', median: 5, counted: 3, excludedLow: 1, unavailable: 1 })
    expect(aggs[0].metrics.find((m) => m.metric === 'trunk_inclination_deg')!.median).toBe(2.5)
    // Turns are only listed for pirouettes.
    expect(aggs[0].metrics.some((m) => m.metric === 'turn_count')).toBe(false)
    expect(aggs[1].metrics.some((m) => m.metric === 'turn_count')).toBe(true)
  })

  it('gives null, never 0, when every value was left out', () => {
    const [g] = subjectAggregates([at('a1', 'S03', 4, 'low'), at('a2', 'S03', null)])
    const trunk = g.metrics.find((m) => m.metric === 'trunk_inclination_deg')!
    expect(trunk).toMatchObject({ median: null, counted: 0, excludedLow: 1, unavailable: 1 })
    expect(median([])).toBeNull()
    expect(median([3, 1, 2])).toBe(2)
  })

  it('writes one CSV row per subject and movement with empty cells for no value', () => {
    const csv = subjectSummaryCsv(subjectAggregates([at('a1', 'S02', 4.123456), at('a2', 'S02', null), at('n1', null, 7)]))
    const lines = csv.trimEnd().split('\r\n')
    expect(lines[0]).toBe(subjectSummaryColumns().join(','))
    expect(lines).toHaveLength(3)
    const cols = subjectSummaryColumns()
    const row = Object.fromEntries(lines[1].split(',').map((v, i) => [cols[i], v]))
    expect(row).toMatchObject({
      subject_code: 'S02',
      movement: 'releve_balance',
      attempts_done: '2',
      trunk_inclination_deg_median: '4.1235',
      trunk_inclination_deg_unit: 'deg',
      trunk_inclination_deg_n_counted: '1',
      trunk_inclination_deg_n_excluded_low_confidence: '0',
      trunk_inclination_deg_n_unavailable: '1',
      turn_count_median: '',
      turn_count_n_counted: '',
    })
    // Clips without a subject code come last, with an empty code cell.
    expect(lines[2].startsWith(',releve_balance,1,')).toBe(true)
    expect(csv).not.toMatch(/\.mp4|a1|n1/)
  })
})
