// Synthetic practice sessions: front-view clips with four relevé balances in
// parallel. No real footage or study data is used anywhere in this prototype.

import type { Attempt, AttemptContext, Keypoint, PhaseId, Point, PoseFrame, RecordingConditions, SessionNotes, SessionResults } from '../types'
import { METRICS, computeSeries } from './metricsEngine'
import { PHASE_LABEL } from '../lib/phases'

export const FPS = 30
export const DURATION = 39
const SHIN = 0.235
const THIGH = 0.245

interface Dropout { from: number; to: number; kind: 'missing' | 'low' }

interface AttemptPlan {
  start: number
  hold: number
  /** Peak inward knee offset, fraction of shin length. */
  kneeDrift: number
  /** How far the shoulders lift toward the ears, body heights. */
  shoulderRise: number
  /** Side-to-side sway amplitude during the hold, degrees. */
  tilt: number
  /** Heel lift on relevé, body heights. */
  lift: number
  context: AttemptContext
  /** Tracking problems, seconds from the attempt start. */
  dropouts?: Dropout[]
}

const PLANS: AttemptPlan[] = [
  { start: 2.0, hold: 1.4, kneeDrift: 0.115, shoulderRise: 0.012, tilt: 3.6, lift: 0.046, context: { view: 'front', music: false, fatigue: 'fresh' } },
  { start: 11.0, hold: 2.0, kneeDrift: 0.085, shoulderRise: 0.034, tilt: 2.6, lift: 0.05, context: { view: 'front', music: true, fatigue: 'fresh' }, dropouts: [{ from: 3.4, to: 3.9, kind: 'low' }] },
  { start: 20.5, hold: 2.8, kneeDrift: 0.04, shoulderRise: 0.014, tilt: 1.4, lift: 0.055, context: { view: 'front', music: false, fatigue: 'some' } },
  { start: 30.5, hold: 2.2, kneeDrift: 0.06, shoulderRise: 0.022, tilt: 2.9, lift: 0.05, context: { view: 'front', music: true, fatigue: 'tired' }, dropouts: [{ from: 3.3, to: 3.9, kind: 'missing' }, { from: 3.9, to: 4.3, kind: 'low' }] },
]

const snap = (t: number) => Math.round(t * FPS) / FPS
const clamp01 = (x: number) => Math.min(1, Math.max(0, x))
const ease = (x: number) => { const u = clamp01(x); return u * u * (3 - 2 * u) }
const lerp = (a: number, b: number, u: number) => a + (b - a) * u

function layout(plan: AttemptPlan, i: number): Attempt {
  const durations: [PhaseId, number][] = [['prep', 1.4], ['rise', 0.8], ['hold', plan.hold], ['release', 1.0]]
  let t = plan.start + 0.5
  const phases = durations.map(([id, d]) => {
    const phase = { id, label: PHASE_LABEL[id], start: snap(t), end: snap(t + d) }
    t += d
    return phase
  })
  return { id: `a${i + 1}`, index: i + 1, start: snap(plan.start), end: snap(t + 0.5), phases, context: plan.context }
}

interface Drivers {
  depth: number // plié depth 0..1
  liftH: number // heel lift, body heights
  arms: number // 0 low, 1 first, 2 fifth
  drift: number // inward knee offset, fraction of shin
  shoulder: number // shoulder rise, body heights
  tilt: number // degrees
}

const STANDING: Drivers = { depth: 0, liftH: 0, arms: 0, drift: 0, shoulder: 0, tilt: 0 }

function drivers(t: number, a: Attempt, p: AttemptPlan): Drivers {
  const [prep, rise, hold, release] = a.phases
  const u = (ph: { start: number; end: number }) => clamp01((t - ph.start) / (ph.end - ph.start))
  const holdTilt = (v: number) => p.tilt * Math.sin((2 * Math.PI * v) / 1.6 + 0.7) * (0.6 + 0.4 * clamp01(v / p.hold))

  if (t < prep.start || t >= release.end) return STANDING
  if (t < rise.start) {
    const k = ease(u(prep) / 0.75)
    return { ...STANDING, depth: k, arms: ease(u(prep)), drift: p.kneeDrift * 0.4 * k }
  }
  if (t < hold.start) {
    const k = ease(u(rise))
    return {
      depth: 1 - ease(u(rise) / 0.55),
      liftH: p.lift * k,
      arms: 1 + k,
      drift: p.kneeDrift * (0.4 + 0.35 * k),
      shoulder: p.shoulderRise * 0.5 * k,
      tilt: holdTilt(0) * k,
    }
  }
  if (t < release.start) {
    const v = t - hold.start
    return {
      depth: 0,
      liftH: p.lift * (1 - 0.04 * Math.sin((2 * Math.PI * v) / 0.9)),
      arms: 2,
      drift: p.kneeDrift * (0.75 + 0.25 * ease(v / 0.8) + 0.08 * Math.sin((2 * Math.PI * v) / 1.1)),
      shoulder: p.shoulderRise * (0.5 + 0.5 * ease(v / 0.5)),
      tilt: holdTilt(v),
    }
  }
  const k = 1 - ease(u(release))
  return { depth: 0.3 * Math.sin(Math.PI * u(release)), liftH: p.lift * k, arms: 2 * k, drift: p.kneeDrift * k, shoulder: p.shoulderRise * k, tilt: holdTilt(p.hold) * k }
}

// Arm positions relative to the shoulder, for the dancer's left side (mirrored for the right).
const ARMS: { elbow: Point; wrist: Point }[] = [
  { elbow: [0.035, -0.14], wrist: [0.05, -0.27] }, // low
  { elbow: [0.06, -0.1], wrist: [-0.04, -0.15] }, // first, rounded in front
  { elbow: [0.05, 0.14], wrist: [-0.06, 0.26] }, // fifth, overhead
]

function armOffset(level: number, key: 'elbow' | 'wrist'): Point {
  const i = Math.min(1, Math.floor(level))
  const u = ease(level - i)
  const a = ARMS[i][key]
  const b = ARMS[i + 1][key]
  return [lerp(a[0], b[0], u), lerp(a[1], b[1], u)]
}

function buildPose(d: Drivers, sway: number): Record<Keypoint, Point> {
  const pts = {} as Record<Keypoint, Point>
  const sides: ['left' | 'right', number][] = [['left', 1], ['right', -1]]
  let hipY = 0
  for (const [side, s] of sides) {
    const footX = s * 0.055
    const ankleY = 0.045 + d.liftH
    const kneeY = ankleY + SHIN * (1 - 0.2 * d.depth)
    hipY = kneeY + THIGH * (1 - 0.3 * d.depth)
    pts[`${side}Toe`] = [footX, 0]
    pts[`${side}Ankle`] = [footX, ankleY]
    pts[`${side}Heel`] = [footX, 0.02 + d.liftH * 1.15]
    pts[`${side}Knee`] = [footX - s * d.drift * SHIN, kneeY]
    pts[`${side}Hip`] = [s * 0.055 + sway, hipY]
  }

  // Upper body is built around the pelvis centre, then tilted.
  const th = (d.tilt * Math.PI) / 180
  const place = ([x, y]: Point): Point => [sway + x * Math.cos(th) + y * Math.sin(th), hipY - x * Math.sin(th) + y * Math.cos(th)]
  for (const [side, s] of sides) {
    const shoulder: Point = [s * 0.11, 0.3 + d.shoulder]
    const e = armOffset(d.arms, 'elbow')
    const w = armOffset(d.arms, 'wrist')
    pts[`${side}Shoulder`] = place(shoulder)
    pts[`${side}Elbow`] = place([shoulder[0] + s * e[0], shoulder[1] + e[1]])
    pts[`${side}Wrist`] = place([shoulder[0] + s * w[0], shoulder[1] + w[1]])
    pts[`${side}Ear`] = place([s * 0.035, 0.385])
  }
  pts.nose = place([0, 0.375])
  return pts
}

/** Deterministic PRNG so every reload shows the same session. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let r = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}

export interface SyntheticSpec {
  id: string
  seed: number
  participant: string
  goal: string
  recordedAt: string
  conditions: RecordingConditions
  /** 0 keeps the reference plans exactly; higher values vary tempo and alignment per attempt. */
  variation: number
  /** Confirmed attempts, or null while the dancer hasn't confirmed them yet. */
  attempts: Attempt[] | null
  boundaryRevision: number
  notes: SessionNotes
}

export const DEMO_SPEC: SyntheticSpec = {
  id: 'demo-session',
  seed: 4850,
  participant: 'P00',
  goal: 'Keep my knees over my toes as I rise',
  recordedAt: '2026-10-28T16:30:00-04:00',
  conditions: { view: 'front', distance: 'medium', music: false, fatigue: 'fresh' },
  variation: 0,
  attempts: null,
  boundaryRevision: 1,
  notes: { moments: [], reflection: '', nextGoal: '' },
}

function plansFor(seed: number, variation: number): AttemptPlan[] {
  if (!variation) return PLANS
  const rand = mulberry32(seed * 7 + 1)
  const vary = (x: number, amount: number) => x * (1 + (rand() - 0.5) * 2 * amount * variation)
  return PLANS.map((p) => ({
    ...p,
    start: p.start + (rand() - 0.5) * 0.8,
    hold: Math.min(3.4, Math.max(1, vary(p.hold, 0.3))),
    kneeDrift: vary(p.kneeDrift, 0.45),
    shoulderRise: vary(p.shoulderRise, 0.45),
    tilt: vary(p.tilt, 0.35),
    lift: vary(p.lift, 0.12),
  }))
}

/** The attempts the synthetic clip was generated with: the ground truth for boundary suggestions. */
export function plannedAttempts(spec: Pick<SyntheticSpec, 'seed' | 'variation'>): Attempt[] {
  return plansFor(spec.seed, spec.variation).map(layout)
}

export interface PoseTrack {
  pose: PoseFrame[]
  series: SessionResults['series']
}

/** The clip's pose and metric series. Depends only on the seed and variation. */
export function buildPoseTrack(spec: Pick<SyntheticSpec, 'seed' | 'variation'>): PoseTrack {
  const rand = mulberry32(spec.seed)
  const gauss = () => Math.sqrt(-2 * Math.log(rand() + 1e-9)) * Math.cos(2 * Math.PI * rand())
  const plans = plansFor(spec.seed, spec.variation)
  const truth = plans.map(layout)

  const pose: PoseFrame[] = []
  for (let i = 0; i <= DURATION * FPS; i++) {
    const t = i / FPS
    const k = truth.findIndex((a) => t >= a.start && t < a.end)
    const d = k >= 0 ? drivers(t, truth[k], plans[k]) : STANDING
    const dropout = k >= 0 ? plans[k].dropouts?.find((o) => t - truth[k].start >= o.from && t - truth[k].start < o.to) : undefined
    if (dropout?.kind === 'missing') {
      pose.push({ t, points: null, confidence: 0 })
      continue
    }
    const sway = 0.004 * Math.sin(t * 0.9) - d.tilt * 0.0012
    const points = buildPose(d, sway)
    const jitter = dropout ? 0.006 : 0.0012
    for (const key of Object.keys(points) as Keypoint[]) {
      points[key] = [points[key][0] + gauss() * jitter, points[key][1] + gauss() * jitter]
    }
    const confidence = dropout ? 0.32 + rand() * 0.1 : 0.9 + rand() * 0.08
    pose.push({ t, points, confidence })
  }
  return { pose, series: computeSeries(pose) }
}

/** Combine a pose track with the session's editable state into the results contract. */
export function assembleResults(spec: SyntheticSpec, track: PoseTrack): SessionResults {
  const attempts = (spec.attempts ?? []).map((a) => ({ ...a, phases: a.phases.map((p) => ({ ...p })) }))
  return {
    session: {
      id: spec.id,
      participant: spec.participant,
      movement: 'Relevé balance in parallel',
      goal: spec.goal,
      recordedAt: spec.recordedAt,
      duration: DURATION,
      fps: FPS,
      synthetic: true,
      boundaryRevision: spec.boundaryRevision,
      attemptsConfirmed: spec.attempts !== null,
      conditions: spec.conditions,
    },
    attempts,
    metrics: METRICS,
    series: track.series,
    pose: track.pose,
    notes: { ...spec.notes, moments: spec.notes.moments.map((m) => ({ ...m })) },
  }
}

export function buildSyntheticSession(spec: SyntheticSpec = DEMO_SPEC): SessionResults {
  return assembleResults(spec, buildPoseTrack(spec))
}
