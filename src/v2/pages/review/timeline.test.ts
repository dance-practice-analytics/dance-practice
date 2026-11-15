import { describe, expect, it } from 'vitest'
import { compareAttempts } from '../../../insights'
import type { AttemptMetricsRow, AttemptRow, SessionRow } from '../../../data/schema'
import { LANDMARK_COUNT, LM, type Landmark, type PoseFrame, type PoseSeries } from '../../../pose/types'
import { differenceText, frameAt, phaseAt, readMetrics } from '../../format'
import { describeAttempt, neighbourInSession, sessionName } from './labels'
import {
  buildTrace,
  countBands,
  frameVisibility,
  niceMax,
  polylinePoints,
  seriesEnd,
  spanStyle,
  traceMax,
  trackingBands,
  trunkAt,
  visibilityAt,
} from './timeline'

// ---------- synthetic poses (no real footage) ----------

/** An upright figure leaning `leanDeg` sideways, every landmark at `visibility`. */
function pose(leanDeg: number, visibility = 0.9): Landmark[] {
  const lm: Landmark[] = Array.from({ length: LANDMARK_COUNT }, () => ({ x: 0, y: 0, z: 0, visibility }))
  const lean = (leanDeg * Math.PI) / 180
  // World: hips at the origin, y down; shoulders 0.5 m up the trunk line.
  const sx = 0.5 * Math.sin(lean)
  const sy = -0.5 * Math.cos(lean)
  lm[LM.leftHip] = { x: -0.1, y: 0, z: 0, visibility }
  lm[LM.rightHip] = { x: 0.1, y: 0, z: 0, visibility }
  lm[LM.leftShoulder] = { x: sx - 0.15, y: sy, z: 0, visibility }
  lm[LM.rightShoulder] = { x: sx + 0.15, y: sy, z: 0, visibility }
  return lm
}

type Spec = { lean: number; vis?: number } | null

function seriesOf(specs: Spec[], fps = 10): PoseSeries {
  const frames: PoseFrame[] = specs.map((s, i) => {
    const lm = s ? pose(s.lean, s.vis) : null
    return { t: i / fps, image: lm, world: lm }
  })
  return { fps, durationS: specs.length / fps, width: 1280, height: 720, model: 'test', smoothed: true, frames }
}

const ok = (lean = 0): Spec => ({ lean })
const weak = (lean = 0): Spec => ({ lean, vis: 0.4 })

describe('trackingBands', () => {
  it('has no bands when every frame is tracked well', () => {
    const s = seriesOf([ok(), ok(), ok()])
    expect(trackingBands(s)).toEqual([])
    expect(countBands(s, [])).toEqual({ gapFrames: 0, lowFrames: 0, totalFrames: 3 })
  })

  it('turns untracked frames into gap bands with exact frame edges', () => {
    const s = seriesOf([ok(), null, null, ok(), ok(), null])
    const bands = trackingBands(s)
    expect(bands).toHaveLength(2)
    expect(bands[0]).toMatchObject({ kind: 'gap', frames: 2 })
    expect(bands[0].start).toBeCloseTo(0.1, 9)
    expect(bands[0].end).toBeCloseTo(0.3, 9)
    // The last band runs to the end of the clip, not past it.
    expect(bands[1]).toMatchObject({ kind: 'gap', frames: 1 })
    expect(bands[1].end).toBeCloseTo(seriesEnd(s), 9)
    expect(countBands(s, bands)).toEqual({ gapFrames: 3, lowFrames: 0, totalFrames: 6 })
  })

  it('keeps low confidence apart from gaps and never merges across tracked frames', () => {
    const s = seriesOf([weak(), weak(), null, ok(), weak(), ok()])
    const bands = trackingBands(s)
    expect(bands.map((b) => [b.kind, b.frames])).toEqual([
      ['low', 2],
      ['gap', 1],
      ['low', 1],
    ])
    expect(bands[2].start).toBeCloseTo(0.4, 9)
    expect(bands[2].end).toBeCloseTo(0.5, 9)
  })

  it('handles an empty series and a clip with no pose at all', () => {
    expect(trackingBands(seriesOf([]))).toEqual([])
    const none = seriesOf([null, null, null])
    expect(trackingBands(none)).toEqual([{ kind: 'gap', start: 0, end: seriesEnd(none), frames: 3 }])
  })

  it('reads the mean visibility of the body joints', () => {
    expect(frameVisibility({ t: 0, image: pose(0, 0.7), world: null })).toBeCloseTo(0.7, 9)
    expect(frameVisibility({ t: 0, image: null, world: null })).toBeNull()
    expect(visibilityAt({ t: 0, image: pose(0, 0.5), world: null })).toEqual({ v: 0.5, low: true })
  })
})

describe('per-frame trunk inclination', () => {
  it('is the angle of the hip-to-shoulder line from vertical', () => {
    expect(trunkAt({ t: 0, image: null, world: pose(0) })?.v).toBeCloseTo(0, 6)
    expect(trunkAt({ t: 0, image: null, world: pose(12) })?.v).toBeCloseTo(12, 6)
    expect(trunkAt({ t: 0, image: null, world: pose(-7.5) })?.v).toBeCloseTo(7.5, 6)
  })

  it('is null on a gap and marked low when a trunk landmark is weakly seen', () => {
    expect(trunkAt({ t: 0, image: null, world: null })).toBeNull()
    expect(trunkAt({ t: 0, image: null, world: pose(5, 0.3) })).toMatchObject({ low: true })
    expect(trunkAt({ t: 0, image: null, world: pose(5, 0.9) })).toMatchObject({ low: false })
  })
})

describe('buildTrace', () => {
  it('breaks the line at every gap instead of drawing across it', () => {
    const s = seriesOf([ok(1), ok(2), null, ok(4), ok(5)])
    const trace = buildTrace(s, trunkAt)
    expect(trace).toHaveLength(2)
    expect(trace[0].points.map((p) => Math.round(p.v))).toEqual([1, 2])
    expect(trace[1].points.map((p) => Math.round(p.v))).toEqual([4, 5])
    expect(trace[1].points[0].t).toBeCloseTo(0.3, 9)
    expect(traceMax(trace)).toBeCloseTo(5, 6)
  })

  it('switches to a dashed segment for weakly seen frames, joined at the boundary', () => {
    const s = seriesOf([ok(1), ok(2), weak(3), weak(4), ok(5)])
    const trace = buildTrace(s, trunkAt)
    expect(trace.map((t) => t.kind)).toEqual(['solid', 'dashed', 'solid'])
    // Each new segment starts at the previous point, so the line stays connected.
    expect(trace[1].points.map((p) => Math.round(p.v))).toEqual([2, 3, 4])
    expect(trace[2].points.map((p) => Math.round(p.v))).toEqual([4, 5])
  })

  it('does not join across a gap even when the kind changes', () => {
    const s = seriesOf([ok(1), null, weak(3)])
    const trace = buildTrace(s, trunkAt)
    expect(trace.map((t) => [t.kind, t.points.length])).toEqual([
      ['solid', 1],
      ['dashed', 1],
    ])
  })

  it('makes a bucket with a missing frame a hole when a long clip is thinned', () => {
    const specs: Spec[] = Array.from({ length: 40 }, (_, i) => (i === 21 ? null : ok(2)))
    const trace = buildTrace(seriesOf(specs), trunkAt, 10)
    // Buckets of 4 frames; the bucket holding frame 21 (frames 20–23) is left out.
    expect(trace).toHaveLength(2)
    expect(trace[0].points).toHaveLength(5)
    expect(trace[1].points[0].t).toBeCloseTo(2.4, 9)
  })
})

describe('drawing helpers', () => {
  it('scales a trace into the box and places B on another time axis', () => {
    const seg = { kind: 'solid' as const, points: [{ t: 0, v: 0 }, { t: 5, v: 10 }, { t: 10, v: 20 }] }
    expect(polylinePoints(seg, 10, 10, 1000, 64)).toBe('0.0,60.0 500.0,4.0 1000.0,4.0')
    expect(polylinePoints(seg, 10, 10, 1000, 64, (t) => t / 2)).toBe('0.0,60.0 250.0,4.0 500.0,4.0')
    expect(polylinePoints(seg, 0, 10, 1000, 64)).toBe('')
  })

  it('gives clamped percentages for a span and a readable axis top', () => {
    expect(spanStyle(2, 4, 8)).toEqual({ left: '25.000%', width: '25.000%' })
    expect(spanStyle(6, 12, 8)).toEqual({ left: '75.000%', width: '25.000%' })
    expect(spanStyle(1, 2, 0)).toEqual({ left: '0%', width: '0%' })
    expect(niceMax(null)).toBe(10)
    expect(niceMax(7.2)).toBe(10)
    expect(niceMax(12.1)).toBe(15)
  })
})

// ---------- the with-values paths the test account can't show yet ----------

const session: SessionRow & { subject_code: string | null; attempt_count: number } = {
  id: 's1',
  owner_id: 'u',
  subject_id: 'sub',
  movement_type: 'releve_balance',
  title: null,
  recorded_on: '2026-11-04',
  camera_view: 'side',
  created_at: '2026-11-04T15:00:00Z',
  subject_code: 'S01',
  attempt_count: 3,
}

function attemptRow(n: number): AttemptRow {
  return {
    id: `a${n}`,
    owner_id: 'u',
    session_id: 's1',
    source: 'study_dataset',
    label: null,
    clip_name: `clip-${n}.mp4`,
    video_path: null,
    video_sha256: null,
    duration_s: 8.4,
    fps: 30,
    status: 'done',
    error: null,
    created_at: `2026-11-04T15:0${n}:00Z`,
  }
}

function metricsRow(n: number, values: Partial<AttemptMetricsRow>, confidence: Record<string, unknown>): AttemptMetricsRow {
  return {
    attempt_id: `a${n}`,
    owner_id: 'u',
    movement: 'releve_balance',
    trunk_inclination_deg: null,
    pelvis_ankle_offset_norm: null,
    balance_duration_s: null,
    knee_tracking_dev_deg: null,
    turn_count: null,
    phases: [
      { phase: 'prep', start: 0, end: 1.2 },
      { phase: 'rise', start: 1.2, end: 2 },
      { phase: 'hold', start: 2, end: 5.4 },
    ],
    confidence: confidence as AttemptMetricsRow['confidence'],
    algorithm_version: 'test',
    computed_at: '2026-11-04T16:12:00Z',
    ...values,
  }
}

describe('measurements with values (synthetic rows)', () => {
  const m2 = metricsRow(
    2,
    { trunk_inclination_deg: 6.31, balance_duration_s: 2.6, knee_tracking_dev_deg: 7.9 },
    {
      trunk_inclination_deg: { level: 'high', score: 0.9, phases: ['hold', 'finish'] },
      balance_duration_s: { level: 'high', score: 0.85, phases: ['hold'] },
      knee_tracking_dev_deg: { level: 'medium', score: 0.6, phases: ['prep', 'finish'] },
      pelvis_ankle_offset_norm: { level: 'low', score: 0, phases: ['hold', 'finish'], reason: 'no_valid_frames' },
    },
  )
  const m3 = metricsRow(
    3,
    { trunk_inclination_deg: 4.18, balance_duration_s: 3.4, knee_tracking_dev_deg: 8.7, pelvis_ankle_offset_norm: 0.06 },
    {
      trunk_inclination_deg: { level: 'high', score: 0.9, phases: ['hold', 'finish'] },
      balance_duration_s: { level: 'high', score: 0.85, phases: ['hold'] },
      knee_tracking_dev_deg: { level: 'low', score: 0.3, phases: ['prep', 'finish'] },
      pelvis_ankle_offset_norm: { level: 'medium', score: 0.6, phases: ['hold', 'finish'] },
    },
  )

  it('reads values, phases and confidence for the cards; a null comes with its reason', () => {
    const readings = readMetrics(m2, 'releve_balance')
    expect(readings.map((r) => r.key)).not.toContain('turn_count')
    const trunk = readings.find((r) => r.key === 'trunk_inclination_deg')!
    expect(trunk).toMatchObject({ value: 6.31, confidence: 'high', phases: ['hold', 'finish'], reason: null })
    const pelvis = readings.find((r) => r.key === 'pelvis_ankle_offset_norm')!
    expect(pelvis.value).toBeNull()
    expect(pelvis.confidence).toBe('none')
    expect(pelvis.reason).toMatch(/weren’t tracked/)
  })

  it('gives each card a neutral difference against the neighbouring attempt, or the reason there is none', () => {
    const cmp = compareAttempts(
      { attempt: attemptRow(2), metrics: m2, session },
      { attempt: attemptRow(3), metrics: m3, session },
      { a: 'attempt 2', b: 'this attempt' },
    )
    const row = (k: string) => cmp.rows.find((r) => r.metric === k)!
    const trunk = row('trunk_inclination_deg')
    expect(trunk.comparable).toBe(true)
    expect(differenceText('trunk_inclination_deg', trunk.b.value, trunk.a.value, 'attempt 2')).toBe('2.1° lower than attempt 2')
    expect(differenceText('balance_duration_s', 3.4, 2.6, 'attempt 2')).toBe('0.8 s longer than attempt 2')
    // Low confidence and a missing value are not compared, and say so in words.
    expect(row('knee_tracking_dev_deg')).toMatchObject({ comparable: false, sentence: 'Not compared: tracking was low in this attempt' })
    expect(row('pelvis_ankle_offset_norm')).toMatchObject({ comparable: false, sentence: 'Not compared: no value in attempt 2' })
    expect(differenceText('pelvis_ankle_offset_norm', 0.06, null, 'attempt 2')).toBeNull()
  })

  it('finds the frame and the phase under the playhead', () => {
    const s = seriesOf([ok(1), ok(2), null, ok(4)], 10)
    expect(frameAt(s, 0.15)?.t).toBeCloseTo(0.1, 9)
    expect(frameAt(s, 0.2)?.image).toBeNull()
    expect(frameAt(s, 99)?.t).toBeCloseTo(0.3, 9)
    expect(phaseAt(m2.phases, 1.2)?.phase).toBe('rise')
    expect(phaseAt(m2.phases, 5.4)).toBeNull()
  })
})

describe('labels', () => {
  const at = (n: number, status = 'done', session_id = 's1') => ({ id: `a${n}`, session_id, number: n, status })

  it('picks the nearest processed attempt before, otherwise after', () => {
    const all = [at(1), at(2), at(3), at(4, 'queued'), at(5)]
    expect(neighbourInSession(at(3), all)?.id).toBe('a2')
    expect(neighbourInSession(at(1), all)?.id).toBe('a2')
    expect(neighbourInSession(at(5), all)?.id).toBe('a3')
    expect(neighbourInSession(at(1), [at(1), at(9, 'done', 'other')])).toBeNull()
  })

  it('names sessions and attempts without a person', () => {
    const now = new Date('2026-11-15T12:00:00')
    expect(sessionName(session, now)).toBe('Session · Nov 4')
    expect(describeAttempt({ number: 2, session }, now)).toBe('Attempt 2 (S01 · Relevé balance · Nov 4)')
  })
})
