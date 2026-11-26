import { describe, expect, it } from 'vitest'
import { LANDMARK_COUNT, LM, type Landmark, type PoseSeries } from '../pose/types'
import { ALGORITHM_VERSION, computeMetrics, confidenceLevel } from './engine'
import fixtureJson from './fixtures/mediapipe-releve-front.json?raw'
import { countLifts, detectLift, segmentPhases } from './phases'
import { TRACK_MIN, VIS_MIN } from './signals'

// ---------- synthetic dancer (no real footage: every number below is made up) ----------
// Hip-centred, y down, metres. Thigh and shin are 0.45 m, so leg length is 0.9 m.
// Feet are parallel under the hips (0.1 m either side) and point towards −z.

const FPS = 30
const N = 150
const LEG_M = 0.9
const RAD = Math.PI / 180

interface Spec {
  /** Heel height above the floor as a share of leg length. */
  lift?: number
  /** Sideways trunk lean in degrees. */
  tilt?: number
  /** Shoulder-line yaw in degrees. */
  yaw?: number
  /** Moves both feet sideways under the pelvis, in metres. */
  footShift?: number
  /** Plié with the knees pointing `dev` degrees away from the feet. */
  plie?: { dev: number }
  /** Right foot off the floor at the knee (pirouette working leg). */
  retire?: boolean
  /** Visibility per landmark index; 1 everywhere else. */
  vis?: Partial<Record<number, number>>
  /** Tracker mislabels the shoulders. */
  swapShoulders?: boolean
  /** Constant offset of the right heel above its toe, as a share of leg length (a per-foot tracker bias). */
  rightHeelBias?: number
}

function pose(s: Spec): Landmark[] {
  const w: Landmark[] = Array.from({ length: LANDMARK_COUNT }, (_, i) => ({ x: 0, y: 0, z: 0, visibility: s.vis?.[i] ?? 1 }))
  const set = (i: number, x: number, y: number, z: number) => Object.assign(w[i], { x, y, z })
  const shift = s.footShift ?? 0
  const heelY = 0.95 - (s.lift ?? 0) * LEG_M

  const leg = (x: number, hip: number, knee: number, ankle: number, heel: number, toe: number, bias = 0) => {
    set(hip, x, 0, 0)
    set(ankle, x + shift, 0.9, 0)
    if (s.plie) {
      const lean = 40 * RAD
      const a = s.plie.dev * RAD
      set(knee, x + shift + 0.45 * Math.sin(lean) * Math.sin(a), 0.9 - 0.45 * Math.cos(lean), -0.45 * Math.sin(lean) * Math.cos(a))
    } else {
      set(knee, x + shift / 2, 0.45, 0)
    }
    set(heel, x + shift, heelY - bias * LEG_M, 0.05)
    set(toe, x + shift, 0.95, -0.15)
  }
  leg(-0.1, LM.leftHip, LM.leftKnee, LM.leftAnkle, LM.leftHeel, LM.leftFootIndex)
  leg(0.1, LM.rightHip, LM.rightKnee, LM.rightAnkle, LM.rightHeel, LM.rightFootIndex, s.rightHeelBias)
  if (s.retire) {
    set(LM.rightHeel, 0.1, 0.5, 0.05)
    set(LM.rightFootIndex, 0.1, 0.6, 0)
  }

  const tilt = (s.tilt ?? 0) * RAD
  const yaw = (s.yaw ?? 0) * RAD
  const mx = 0.5 * Math.sin(tilt)
  const my = -0.5 * Math.cos(tilt)
  const [a, b] = s.swapShoulders ? [LM.leftShoulder, LM.rightShoulder] : [LM.rightShoulder, LM.leftShoulder]
  set(a, mx + 0.18 * Math.cos(yaw), my, 0.18 * Math.sin(yaw))
  set(b, mx - 0.18 * Math.cos(yaw), my, -0.18 * Math.sin(yaw))
  return w
}

function series(at: (i: number) => Spec | null, n = N): PoseSeries {
  return {
    fps: FPS,
    durationS: n / FPS,
    width: 720,
    height: 1280,
    model: 'synthetic',
    smoothed: true,
    frames: Array.from({ length: n }, (_, i) => {
      const s = at(i)
      return { t: i / FPS, image: null, world: s ? pose(s) : null }
    }),
  }
}

/** Stand 1 s, rise over frames 30–45 to 8% of leg length, hold, lower over 105–120, stand. */
function liftAt(i: number): number {
  if (i < 30) return 0
  if (i < 45) return (0.08 * (i - 30)) / 15
  if (i < 105) return 0.08
  if (i < 120) return 0.08 * (1 - (i - 105) / 15)
  return 0
}

const releve = (extra: (i: number) => Spec | null = () => ({})) =>
  series((i) => {
    const e = extra(i)
    return e ? { lift: liftAt(i), ...e } : null
  })

/** Relevé plus a turn: the shoulders rotate `step` degrees per frame over frames 45–75. */
const pirouette = (step: number, extra: (i: number) => Spec | null = () => ({})) =>
  series((i) => {
    const e = extra(i)
    if (!e) return null
    return { lift: liftAt(i), yaw: step * Math.min(30, Math.max(0, i - 45)), retire: i >= 34 && i < 105, ...e }
  })

const frame = (i: number) => i / FPS
const spans = (m: { phases: { phase: string; start: number; end: number }[] }) =>
  m.phases.map((p) => [p.phase, Math.round(p.start * FPS), Math.round(p.end * FPS)])

// The 2% threshold is crossed at frame 34, the heel settles at 45, it drops under 1% at 119.
const CLEAN = [
  ['prep', 0, 34],
  ['rise', 34, 45],
  ['hold', 45, 119],
  ['finish', 119, 134],
  ['recovery', 134, 150],
]
const HOLD_FINISH_FRAMES = 134 - 45

describe('phase state machine', () => {
  it('segments a relevé into prep, rise, hold, finish and recovery', () => {
    const m = computeMetrics(releve(), 'releve_balance')
    expect(spans(m)).toEqual(CLEAN)
    expect(m.phases[0].start).toBe(0)
    expect(m.phases[1].start).toBeCloseTo(frame(34), 9)
    expect(m.phases[4].end).toBeCloseTo(5, 9)
  })

  it('measures a trimmed series (FR-3.2.7) the same and ends it at the trim, in clip time', () => {
    const plain = releve()
    // The same 5 s of frames, as if cut from 2–7 s of a 9 s clip.
    const trimmed = { ...plain, durationS: 9, trim: { startS: 2, endS: 7 }, frames: plain.frames.map((f) => ({ ...f, t: f.t + 2 })) }
    const a = computeMetrics(plain, 'releve_balance')
    const b = computeMetrics(trimmed, 'releve_balance')
    expect(b.trunk_inclination_deg).toBe(a.trunk_inclination_deg)
    expect(b.balance_duration_s).toBe(a.balance_duration_s)
    expect(b.phases[0].start).toBeCloseTo(2, 9)
    expect(b.phases[1].start).toBeCloseTo(2 + frame(34), 9)
    expect(b.phases.at(-1)!.end).toBeCloseTo(7, 9)
  })

  it('needs 3 consecutive frames above 2% to start a lift', () => {
    expect(detectLift([0, 0.03, 0.03, 0, 0.03, 0.03, 0.03, 0.03, 0])).toEqual({ onset: 4, end: 8 })
    expect(detectLift([0, 0.019, 0.019, 0.019, 0.019])).toBeNull()
    // Two-frame blips while standing do not move the onset.
    const m = computeMetrics(releve((i) => (i === 20 || i === 21 ? { lift: 0.03 } : {})), 'releve_balance')
    expect(spans(m)).toEqual(CLEAN)
  })

  it('does not flicker when the heel hovers between the 1% and 2% thresholds', () => {
    // Above 1% the lift continues even though the signal is back under the 2% on-threshold.
    expect(detectLift([0, 0.03, 0.03, 0.03, 0.015, 0.03, 0.012, 0.03, 0.009, 0.03])).toEqual({ onset: 1, end: 8 })
    const wobble = releve((i) => (i >= 50 && i < 100 ? { lift: i % 2 ? 0.012 : 0.03 } : {}))
    const m = computeMetrics(wobble, 'releve_balance')
    expect(m.phases.map((p) => p.phase)).toEqual(['prep', 'rise', 'hold', 'finish', 'recovery'])
    expect(spans(m)[2]).toEqual(['hold', 45, 119])
  })

  it('keeps its state across a gap and never starts a lift inside one', () => {
    expect(detectLift([0, 0.03, null, 0.03, 0.03, 0])).toBeNull()
    expect(detectLift([0, 0.03, 0.03, 0.03, null, null, 0.03, 0])).toEqual({ onset: 1, end: 7 })
  })

  it('runs to the end of the clip when the heel never comes down', () => {
    const m = computeMetrics(series((i) => ({ lift: liftAt(Math.min(i, 100)) })), 'releve_balance')
    expect(spans(m)).toEqual([
      ['prep', 0, 34],
      ['rise', 34, 45],
      ['hold', 45, 150],
    ])
  })
})

describe('metrics against known values', () => {
  it('trunk inclination is the median angle from vertical in hold and finish', () => {
    const m = computeMetrics(releve(() => ({ tilt: 8 })), 'releve_balance')
    expect(m.trunk_inclination_deg).toBeCloseTo(8, 6)
    // Unsigned: leaning the other way reads the same.
    expect(computeMetrics(releve(() => ({ tilt: -8 })), 'releve_balance').trunk_inclination_deg).toBeCloseTo(8, 6)
    // Only hold and finish count: a lean while standing before the rise is not in the value.
    const early = computeMetrics(releve((i) => ({ tilt: i < 34 ? 25 : 3 })), 'releve_balance')
    expect(early.trunk_inclination_deg).toBeCloseTo(3, 6)
  })

  it('pelvis–ankle offset is the horizontal distance over leg length', () => {
    // Supporting (left) ankle 0.1 m to the side of the hip midpoint, leg 0.9 m.
    const m = computeMetrics(releve(), 'releve_balance')
    expect(m.pelvis_ankle_offset_norm).toBeCloseTo(0.1 / LEG_M, 6)
    // Feet together under the pelvis: the left ankle sits exactly below the hip midpoint.
    const centred = computeMetrics(releve((i) => (i >= 45 ? { footShift: 0.1 } : {})), 'releve_balance')
    expect(centred.pelvis_ankle_offset_norm).toBeCloseTo(0, 6)
  })

  it('balance duration is the longest steady run of hold frames', () => {
    const m = computeMetrics(releve(), 'releve_balance')
    expect(m.balance_duration_s).toBeCloseTo((119 - 45) / FPS, 6)
    // Frames 70–75 step 0.2 m sideways: offset (0.3 / 0.9) leaves the band there. Speed is
    // measured over 0.2 s (3 frames either side), so the step out is seen by frames 67–72
    // and the step back by 73–78, at 1 m/s. Longest steady run left: frames 79–118.
    // (It was 42 frames, 77–118, before mt2-metrics-1.1.0: speed came from the previous frame.)
    const sway = computeMetrics(releve((i) => (i >= 70 && i <= 75 ? { footShift: -0.2 } : {})), 'releve_balance')
    expect(sway.balance_duration_s).toBeCloseTo(40 / FPS, 6)
  })

  it('balance duration is not cut short by frame-to-frame jitter', () => {
    // The feet jump 6 mm sideways and back on alternate frames: 0.18 m/s between
    // neighbours, over the 0.15 limit. Over 0.2 s the pelvis has gone nowhere.
    const m = computeMetrics(releve((i) => ({ footShift: i % 2 ? 0.003 : -0.003 })), 'releve_balance')
    expect(m.balance_duration_s).toBeCloseTo((119 - 45) / FPS, 6)
  })

  it('knee tracking deviation is the horizontal angle between knee and foot direction in the plié', () => {
    const m = computeMetrics(releve((i) => (i >= 18 && i < 28 ? { plie: { dev: 12 } } : {})), 'releve_balance')
    expect(m.knee_tracking_dev_deg).toBeCloseTo(12, 6)
    expect(m.confidence.knee_tracking_dev_deg.reason).toBeUndefined()
    expect(m.confidence.knee_tracking_dev_deg.phases).toEqual(['prep', 'finish'])
  })

  it('returns the attempt_metrics columns and nothing that grades', () => {
    const m = computeMetrics(releve(), 'releve_balance')
    expect(Object.keys(m).sort()).toEqual(
      [
        'movement',
        'trunk_inclination_deg',
        'pelvis_ankle_offset_norm',
        'balance_duration_s',
        'knee_tracking_dev_deg',
        'turn_count',
        'feet_angle_deg',
        'phases',
        'confidence',
        'algorithm_version',
      ].sort(),
    )
    expect(m.movement).toBe('releve_balance')
    expect(m.algorithm_version).toBe(ALGORITHM_VERSION)
    expect(JSON.parse(JSON.stringify(m))).toEqual(m)
  })
})

describe('gaps', () => {
  const gap = (i: number) => i >= 60 && i < 65

  it('lower the confidence and are left out of the value', () => {
    const clean = computeMetrics(releve(() => ({ tilt: 8 })), 'releve_balance')
    const m = computeMetrics(releve((i) => (gap(i) ? null : { tilt: 8 })), 'releve_balance')
    expect(spans(m)).toEqual(CLEAN)
    // Zeroed or interpolated-to-vertical frames would pull these away from the true values.
    expect(m.trunk_inclination_deg).toBeCloseTo(8, 6)
    expect(m.pelvis_ankle_offset_norm).toBeCloseTo(0.1 / LEG_M, 6)
    expect(clean.confidence.trunk_inclination_deg.score).toBeCloseTo(1, 9)
    expect(m.confidence.trunk_inclination_deg.score).toBeCloseTo((HOLD_FINISH_FRAMES - 5) / HOLD_FINISH_FRAMES, 9)
    expect(m.confidence.balance_duration_s.score).toBeCloseTo((74 - 5) / 74, 9)
  })

  it('split a balance instead of being bridged', () => {
    const m = computeMetrics(releve((i) => (gap(i) ? null : {})), 'releve_balance')
    // 45–59 and 65–118 are separate runs; the full hold would be 74 frames.
    expect(m.balance_duration_s).toBeCloseTo(54 / FPS, 6)
  })

  it('count landmarks under the tracking gate as missing, not as data', () => {
    // The shoulders are "seen" leaning 40° at visibility 0.2 in every frame but five.
    // Were those frames data, the median would be 40.
    const lost = { [LM.leftShoulder]: 0.2, [LM.rightShoulder]: 0.2 }
    const m = computeMetrics(releve((i) => (gap(i) ? { tilt: 8 } : { tilt: 40, vis: lost })), 'releve_balance')
    expect(m.trunk_inclination_deg).toBeCloseTo(8, 6)
    expect(m.confidence.trunk_inclination_deg.score).toBeCloseTo(5 / HOLD_FINISH_FRAMES, 9)
    // Other metrics do not use the shoulders.
    expect(m.confidence.pelvis_ankle_offset_norm.score).toBeCloseTo(1, 9)
  })
})

describe('weak tracking (visibility between the tracking gate and 0.6)', () => {
  const feet = (v: number) => ({ [LM.leftHeel]: v, [LM.rightHeel]: v, [LM.leftFootIndex]: v, [LM.rightFootIndex]: v })

  it('uses a landmark from 0.3 and trusts it from the 0.6 of the SDD', () => {
    expect(TRACK_MIN).toBe(0.3)
    expect(VIS_MIN).toBe(0.6)
  })

  it('still finds the phases when the feet are weakly visible, as MediaPipe reports them', () => {
    const m = computeMetrics(releve(() => ({ vis: feet(0.45) })), 'releve_balance')
    expect(spans(m)).toEqual(CLEAN)
    // Metrics that do not use the feet keep their full confidence.
    expect(m.confidence.trunk_inclination_deg).toMatchObject({ level: 'high', score: 1 })
  })

  it('gives a value flagged low confidence, not a null and not a confident value', () => {
    const m = computeMetrics(releve(() => ({ vis: { [LM.leftAnkle]: 0.45 } })), 'releve_balance')
    expect(m.pelvis_ankle_offset_norm).toBeCloseTo(0.1 / LEG_M, 6)
    expect(m.balance_duration_s).toBeCloseTo((119 - 45) / FPS, 6)
    // No frame reaches 0.6, so the SDD score is 0.
    expect(m.confidence.pelvis_ankle_offset_norm).toEqual({ level: 'low', score: 0, phases: ['hold', 'finish'] })
    expect(m.confidence.balance_duration_s).toEqual({ level: 'low', score: 0, phases: ['hold'] })
  })

  it('counts only the frames at 0.6 or more towards the score', () => {
    // Ankle weak for 55 of the 89 hold + finish frames: every frame is in the value,
    // 34 of them in the score.
    const m = computeMetrics(releve((i) => (i >= 50 && i < 105 ? { vis: { [LM.leftAnkle]: 0.45 } } : {})), 'releve_balance')
    expect(m.pelvis_ankle_offset_norm).toBeCloseTo(0.1 / LEG_M, 6)
    expect(m.confidence.pelvis_ankle_offset_norm.score).toBeCloseTo((HOLD_FINISH_FRAMES - 55) / HOLD_FINISH_FRAMES, 9)
    expect(m.confidence.pelvis_ankle_offset_norm.level).toBe('low')
    // The balance is split by untracked frames only, not by weak ones.
    expect(m.balance_duration_s).toBeCloseTo((119 - 45) / FPS, 6)
  })

  it('is a gap below the tracking gate: no floor, no phases, no values', () => {
    const m = computeMetrics(releve(() => ({ vis: feet(0.25) })), 'releve_balance')
    expect(m.phases).toEqual([])
    expect(m.trunk_inclination_deg).toBeNull()
    expect(m.confidence.trunk_inclination_deg.reason).toBe('no_floor_reference')
  })
})

// ---------- real MediaPipe output ----------
// Excerpt of what the Pose Landmarker returned for a generated stick-figure test clip
// (see the note in the fixture: synthetic, no person). Everything above is hand-built
// with perfect visibility; this is the only place the engine meets real tracker output.

interface Fixture {
  fps: number
  width: number
  height: number
  model: string
  smoothed: boolean
  units: { xyz: number; visibility: number; t: number }
  landmarks: number[]
  t: number[]
  frames: number[][]
}

function fixtureSeries(): PoseSeries {
  const fx = JSON.parse(fixtureJson) as Fixture
  return {
    fps: fx.fps,
    durationS: fx.frames.length / fx.fps,
    width: fx.width,
    height: fx.height,
    model: fx.model,
    smoothed: fx.smoothed,
    frames: fx.frames.map((row, i) => {
      // Landmarks the engine does not read are not in the file: rebuilt as untracked.
      const world: Landmark[] = Array.from({ length: LANDMARK_COUNT }, () => ({ x: 0, y: 0, z: 0, visibility: 0 }))
      fx.landmarks.forEach((lm, k) => {
        world[lm] = {
          x: row[k * 4] * fx.units.xyz,
          y: row[k * 4 + 1] * fx.units.xyz,
          z: row[k * 4 + 2] * fx.units.xyz,
          visibility: row[k * 4 + 3] * fx.units.visibility,
        }
      })
      return { t: fx.t[i] * fx.units.t, image: null, world }
    }),
  }
}

describe('real MediaPipe output (synthetic stick-figure clip, front view)', () => {
  const real = fixtureSeries()
  const m = computeMetrics(real, 'releve_balance')
  const share = (lm: number, min: number) =>
    real.frames.filter((f) => (f.world as Landmark[])[lm].visibility >= min).length / real.frames.length

  it('has feet that the 0.6 gate alone would throw away', () => {
    expect(real.frames).toHaveLength(540)
    expect(real.frames.every((f) => f.world)).toBe(true)
    // Why mt2-metrics-1.0.0 returned no_floor_reference for this clip.
    expect(share(LM.rightFootIndex, VIS_MIN)).toBeLessThan(0.01)
    expect(share(LM.leftFootIndex, VIS_MIN)).toBeLessThan(0.25)
    // Under the tracking gate only while the tracker settles (right toe, 7 of the first 8 frames).
    expect(share(LM.rightFootIndex, TRACK_MIN)).toBeCloseTo(533 / 540, 9)
    expect(share(LM.leftFootIndex, TRACK_MIN)).toBe(1)
    expect(share(LM.leftHip, VIS_MIN)).toBe(1)
  })

  it('finds the first lift where the clip generator put it', () => {
    // Since mt2-metrics-1.2.0 this parallel relevé is measured on the left leg (the SDD tie
    // rule); before, the right heel read a hair lower and won.
    expect(spans(m)).toEqual([
      ['prep', 0, 131],
      ['rise', 131, 138],
      ['hold', 138, 199],
      ['finish', 199, 214],
      ['recovery', 214, 540],
    ])
    // The generator rises over 3.93–4.73 s, holds to 5.87 s and lowers the heels over 5.87–6.87 s.
    const [, rise, hold, finish] = m.phases
    expect(rise.start).toBeGreaterThan(3.93)
    expect(rise.start).toBeLessThan(4.73)
    expect(Math.abs(hold.start - 4.73)).toBeLessThan(0.15)
    expect(finish.start).toBeGreaterThan(5.87)
    expect(finish.start).toBeLessThan(6.87)
    const seg = segmentPhases(real, 'releve_balance')
    expect(seg.support).toBe('left')
    expect(seg.lifts).toBe(2)
    expect(seg.legLength).toBeCloseTo(0.771, 2)
  })

  it('does not see a lift while the figure stands still or settles', () => {
    // Frames 0–117 end with the plié of the generator. The settling of the first 0.6 s
    // reads far below the floor, never above it.
    const { lift } = segmentPhases(real, 'releve_balance')
    const standing = lift.slice(0, 118).filter((v): v is number => v !== null)
    // The supporting (left) foot is tracked in every frame (the right toe is under the
    // tracking gate in 7 of the first 8 frames, but it does not support here).
    expect(standing).toHaveLength(118)
    expect(Math.min(...standing)).toBeLessThan(-0.05)
    expect(Math.max(...standing)).toBeLessThan(0.01)
  })

  it('reports values with the confidence the visibility supports', () => {
    expect(m.algorithm_version).toBe(ALGORITHM_VERSION)
    // Shoulders and hips are fully visible. The drawn trunk leans 1.3° (median); MediaPipe
    // gives the flat figure a sideways lean of ~2° even while it stands (CALIBRATION.md).
    expect(m.trunk_inclination_deg).toBeCloseTo(2.98, 1)
    expect(m.confidence.trunk_inclination_deg).toMatchObject({ level: 'high', score: 1 })
    // The left ankle is weakly visible while lifted: a value, at low confidence. Drawn
    // offset 0.12; the tracker puts the hip midpoint ~0.04 leg lengths towards the left
    // ankle in every clip, and the right ankle as far the other way (CALIBRATION.md).
    expect(m.pelvis_ankle_offset_norm).toBeCloseTo(0.073, 2)
    expect(m.confidence.pelvis_ankle_offset_norm.level).toBe('low')
    expect(m.confidence.pelvis_ankle_offset_norm.score).toBeCloseTo(0.46, 2)
    // Drawn: 2.1 s. Depth noise of the tracker breaks the band (CALIBRATION.md, known limit).
    expect(m.balance_duration_s).toBeCloseTo(0.6, 6)
    expect(m.confidence.balance_duration_s.level).toBe('low')
    expect(m.confidence.balance_duration_s.score).toBeCloseTo(0.34, 2)
    for (const k of ['trunk_inclination_deg', 'pelvis_ankle_offset_norm', 'balance_duration_s'] as const) {
      expect(m.confidence[k].clip_notes).toEqual(['multiple_lifts_detected'])
      expect(m.confidence[k].reason).toBeUndefined()
    }
  })

  it('keeps what it cannot measure null, with the reason', () => {
    // The plié of the generator is a forward knee bend. From the front MediaPipe does not
    // reconstruct it: the world knee stays under 15° of flexion in prep and finish.
    expect(m.knee_tracking_dev_deg).toBeNull()
    expect(m.confidence.knee_tracking_dev_deg).toEqual({ level: 'low', score: 0, phases: ['prep', 'finish'], reason: 'knee_not_bent' })
    expect(m.turn_count).toBeNull()
    expect(m.confidence.turn_count.reason).toBe('not_applicable')
  })
})

describe('floor level', () => {
  it('ignores the tracker settling in the first 0.5 s', () => {
    // The first 15 frames read the heels 5% of leg length under the level they settle
    // at, as the first detections of a clip do. A floor taken from them would put the
    // standing dancer 5% "up" from frame 15 on.
    const m = computeMetrics(series((i) => ({ lift: i < 15 ? -0.05 : liftAt(i) })), 'releve_balance')
    expect(spans(m)).toEqual(CLEAN)
  })

  it('is taken per foot, so a constant offset of one foot is not a lift', () => {
    // The right heel always reads 2.5% of leg length above its toe, more than the 2%
    // threshold. Pooled with the left foot, the floor would sit in between.
    const m = computeMetrics(releve(() => ({ rightHeelBias: 0.025 })), 'releve_balance')
    expect(spans(m)).toEqual(CLEAN)
    // Standing still with the same offset is no lift at all.
    const still = computeMetrics(series(() => ({ rightHeelBias: 0.025 })), 'releve_balance')
    expect(still.confidence.trunk_inclination_deg.reason).toBe('no_lift_detected')
  })

  it('uses the last frames of a clip shorter than the settling time', () => {
    const m = computeMetrics(series(() => ({}), 10), 'releve_balance')
    expect(m.confidence.balance_duration_s.reason).toBe('no_lift_detected')
  })
})

describe('several lifts in one clip', () => {
  // The relevé of `liftAt` twice: frames 0–149 and 150–299.
  const twice = () => series((i) => ({ lift: liftAt(i % N), tilt: i < N ? 8 : 20 }), 2 * N)

  it('counts the lifts', () => {
    expect(countLifts([0, 0.03, 0.03, 0.03, 0, 0, 0.03, 0.03, 0.03, 0.03, 0])).toBe(2)
    expect(countLifts([0, 0.03, 0.03, 0])).toBe(0)
    expect(segmentPhases(twice(), 'releve_balance').lifts).toBe(2)
    expect(segmentPhases(releve(), 'releve_balance').lifts).toBe(1)
  })

  it('measures the first lift only and says so on every value', () => {
    const m = computeMetrics(twice(), 'releve_balance')
    expect(spans(m)).toEqual([...CLEAN.slice(0, 4), ['recovery', 134, 300]])
    // The second lift leans 20°. It is not in the value.
    expect(m.trunk_inclination_deg).toBeCloseTo(8, 6)
    for (const k of ['trunk_inclination_deg', 'pelvis_ankle_offset_norm', 'balance_duration_s'] as const) {
      expect(m.confidence[k].clip_notes).toEqual(['multiple_lifts_detected'])
    }
    // Nulls carry their reason, not the note.
    expect(m.confidence.knee_tracking_dev_deg.clip_notes).toBeUndefined()
    expect(m.confidence.turn_count.clip_notes).toBeUndefined()
  })

  it('a single lift has no clip note', () => {
    const m = computeMetrics(releve(), 'releve_balance')
    expect(m.confidence.trunk_inclination_deg.clip_notes).toBeUndefined()
  })
})

describe('metrics that cannot be computed', () => {
  const keys = ['trunk_inclination_deg', 'pelvis_ankle_offset_norm', 'balance_duration_s', 'knee_tracking_dev_deg'] as const

  it('are null with no_valid_frames when the landmarks are never tracked in the phase', () => {
    const m = computeMetrics(releve(() => ({ vis: { [LM.leftShoulder]: 0.2 } })), 'releve_balance')
    expect(m.trunk_inclination_deg).toBeNull()
    expect(m.confidence.trunk_inclination_deg).toEqual({ level: 'low', score: 0, phases: ['hold', 'finish'], reason: 'no_valid_frames' })
    expect(m.pelvis_ankle_offset_norm).not.toBeNull()
    expect(m.balance_duration_s).not.toBeNull()
  })

  it('knee tracking is null with knee_not_bent when there is no plié', () => {
    const m = computeMetrics(releve(), 'releve_balance')
    expect(m.knee_tracking_dev_deg).toBeNull()
    expect(m.confidence.knee_tracking_dev_deg.reason).toBe('knee_not_bent')
  })

  it('turn count is not_applicable for a relevé balance', () => {
    const m = computeMetrics(releve(), 'releve_balance')
    expect(m.turn_count).toBeNull()
    expect(m.confidence.turn_count.reason).toBe('not_applicable')
  })

  it('everything is null with no_lift_detected when the heels stay down', () => {
    const m = computeMetrics(series(() => ({ tilt: 5 })), 'releve_balance')
    expect(spans(m)).toEqual([['prep', 0, 150]])
    for (const k of keys) {
      expect(m[k]).toBeNull()
      expect(m.confidence[k].reason).toBe('no_lift_detected')
    }
  })

  it('everything is null with no_pose when no frame has a pose', () => {
    const m = computeMetrics(series(() => null), 'pirouette')
    expect(m.phases).toEqual([])
    for (const k of [...keys, 'turn_count'] as const) {
      expect(m[k]).toBeNull()
      expect(m.confidence[k]).toMatchObject({ level: 'low', score: 0, reason: 'no_pose' })
    }
  })

  it('everything is null with no_floor_reference when the feet are untracked in the floor window', () => {
    // The floor window is 0.5–1.0 s since mt2-metrics-1.1.0 (it was 0–0.5 s).
    const feet = { [LM.leftHeel]: 0.1, [LM.rightHeel]: 0.1 }
    const m = computeMetrics(releve((i) => (i >= 15 && i < 30 ? { vis: feet } : {})), 'releve_balance')
    expect(m.phases).toEqual([])
    for (const k of keys) expect(m.confidence[k].reason).toBe('no_floor_reference')
    // Untracked feet before the window no longer matter.
    const early = computeMetrics(releve((i) => (i < 15 ? { vis: feet } : {})), 'releve_balance')
    expect(spans(early)).toEqual(CLEAN)
  })

  it('handles an empty series', () => {
    const m = computeMetrics(series(() => null, 0), 'releve_balance')
    expect(m.phases).toEqual([])
    expect(m.balance_duration_s).toBeNull()
  })
})

describe('confidence', () => {
  const torso = (v: number) => ({ [LM.leftShoulder]: v, [LM.rightShoulder]: v, [LM.leftHip]: v, [LM.rightHip]: v })

  it('bands are high from 0.8, medium from 0.5, low below', () => {
    expect(confidenceLevel(1)).toBe('high')
    expect(confidenceLevel(0.8)).toBe('high')
    expect(confidenceLevel(0.79)).toBe('medium')
    expect(confidenceLevel(0.5)).toBe('medium')
    expect(confidenceLevel(0.49)).toBe('low')
    expect(confidenceLevel(0)).toBe('low')
  })

  it('score is the share of tracked frames times their mean visibility', () => {
    const high = computeMetrics(releve(() => ({ vis: torso(0.9) })), 'releve_balance')
    expect(high.confidence.trunk_inclination_deg).toMatchObject({ level: 'high', phases: ['hold', 'finish'] })
    expect(high.confidence.trunk_inclination_deg.score).toBeCloseTo(0.9, 9)

    const medium = computeMetrics(releve(() => ({ vis: torso(0.7) })), 'releve_balance')
    expect(medium.confidence.trunk_inclination_deg.level).toBe('medium')
    expect(medium.confidence.trunk_inclination_deg.score).toBeCloseTo(0.7, 9)

    // Shoulders lost for 55 of the 89 hold + finish frames: the value stays, the level drops.
    const low = computeMetrics(releve((i) => ({ tilt: 8, vis: i >= 50 && i < 105 ? torso(0.3) : {} })), 'releve_balance')
    expect(low.trunk_inclination_deg).toBeCloseTo(8, 6)
    expect(low.confidence.trunk_inclination_deg.level).toBe('low')
    expect(low.confidence.trunk_inclination_deg.score).toBeCloseTo((HOLD_FINISH_FRAMES - 55) / HOLD_FINISH_FRAMES, 9)
  })
})

describe('parallel feet (feet_angle_deg)', () => {
  it('reads the parallel feet of the relevé as 0°, from the hold, capped at low confidence', () => {
    const m = computeMetrics(releve(), 'releve_balance')
    expect(m.feet_angle_deg).toBeCloseTo(0, 6)
    // Fully visible, but the foot direction rests on depth: low whatever the score, and it says why.
    expect(m.confidence.feet_angle_deg).toMatchObject({ level: 'low', score: 1, phases: ['hold'], notes: ['depth_limited'] })
    expect(m.algorithm_version).toBe('mt2-metrics-1.3.0')
  })

  it('is not applicable to a pirouette, and a gap is null with a reason, never 0', () => {
    const p = computeMetrics(pirouette(24), 'pirouette')
    expect(p.feet_angle_deg).toBeNull()
    expect(p.confidence.feet_angle_deg.reason).toBe('not_applicable')
    // Toes untracked through the whole clip.
    const hidden = computeMetrics(releve(() => ({ vis: { [LM.leftFootIndex]: 0.1, [LM.rightFootIndex]: 0.1 } })), 'releve_balance')
    expect(hidden.feet_angle_deg).toBeNull()
    expect(hidden.confidence.feet_angle_deg.reason).toBeTruthy()
  })
})

describe('pirouette', () => {
  it('finds the turn phase and counts two turns', () => {
    const s = pirouette(24)
    const m = computeMetrics(s, 'pirouette')
    expect(spans(m)).toEqual([
      ['prep', 0, 34],
      ['rise', 34, 45],
      ['turn', 45, 76],
      ['hold', 76, 119],
      ['finish', 119, 134],
      ['recovery', 134, 150],
    ])
    expect(m.turn_count).toBe(2)
    expect(m.confidence.turn_count).toEqual({ level: 'high', score: 1, phases: ['turn'] })
    // The working leg is off the floor, so the left leg supports.
    expect(segmentPhases(s, 'pirouette').support).toBe('left')
    expect(m.pelvis_ankle_offset_norm).toBeCloseTo(0.1 / LEG_M, 6)
    expect(m.balance_duration_s).toBeCloseTo((119 - 76) / FPS, 6)
  })

  it('rounds to the nearest quarter turn and ignores direction', () => {
    expect(computeMetrics(pirouette(15), 'pirouette').turn_count).toBe(1.25) // 450°
    expect(computeMetrics(pirouette(-15), 'pirouette').turn_count).toBe(1.25)
    expect(computeMetrics(pirouette(13), 'pirouette').turn_count).toBe(1) // 390°
  })

  it('the same clip scored as a relevé has no turn phase', () => {
    const m = computeMetrics(pirouette(24), 'releve_balance')
    expect(m.phases.map((p) => p.phase)).toEqual(['prep', 'rise', 'hold', 'finish', 'recovery'])
    expect(m.turn_count).toBeNull()
  })

  it('is null with no_turn_detected when the shoulders never rotate', () => {
    const m = computeMetrics(pirouette(0), 'pirouette')
    expect(m.turn_count).toBeNull()
    expect(m.confidence.turn_count.reason).toBe('no_turn_detected')
  })

  it('corrects a left/right swap and lowers the confidence', () => {
    const m = computeMetrics(pirouette(24, (i) => ({ swapShoulders: i >= 55 && i <= 60 })), 'pirouette')
    expect(m.turn_count).toBe(2)
    // Swap at 55 and swap back at 61: 2 of the 31 turn frames are not counted.
    expect(m.confidence.turn_count.score).toBeCloseTo(29 / 31, 9)
    expect(m.confidence.turn_count.notes).toEqual(['left_right_swap_corrected'])
  })

  it('marks the estimate low confidence when tracking is lost during the turn', () => {
    const m = computeMetrics(pirouette(24, (i) => (i >= 55 && i < 59 ? null : {})), 'pirouette')
    expect(m.turn_count).toBe(2)
    expect(m.confidence.turn_count.level).toBe('low')
    expect(m.confidence.turn_count.score).toBeCloseTo(27 / 31, 9)
    expect(m.confidence.turn_count.notes).toEqual(['tracking_lost_in_turn'])
  })
})
