// First-run sample session: three relevé balance attempts drawn from the synthetic
// dancer (src/metrics/testing/syntheticDancer.ts), degraded like tracker output and
// smoothed like the pipeline does, then measured by the real metrics engine. Every
// number is made up: no footage, no participant, no video at all (Review shows the
// skeleton only). Saving lives in sampleSave.ts so this file stays pure and testable.

import { computeMetrics } from '../metrics/engine'
import {
  addTrackerNoise,
  dancerLandmarks,
  liftProfile,
  MEDIAPIPE_LIKE,
  NEUTRAL,
  RELEVE,
  type DancerPose,
  type NoiseModel,
} from '../metrics/testing/syntheticDancer'
import type { AttemptMetrics } from '../metrics/types'
import { smoothSeries } from '../pose/oneEuro'
import { LM, type Landmark, type PoseFrame, type PoseSeries } from '../pose/types'

import { SAMPLE_ATTEMPT_LABEL, SAMPLE_MODEL } from './sampleMarkers'

export { isSampleAttempt, isSampleSession, SAMPLE_ATTEMPT_LABEL, SAMPLE_MODEL, SAMPLE_SESSION_TITLE } from './sampleMarkers'

const FPS = 30
const WIDTH = 720
const HEIGHT = 1280

interface AttemptPlan {
  seed: number
  holdS: number
  trunkDeg: number
  /** Hip midpoint minus supporting ankle, metres. */
  offset: { x: number; z: number }
  /** Side-to-side sway during the hold, metres (peak). */
  sway: number
  plie: { bendDeg: number; devDeg: number }
}

// Three attempts that differ a little, so Compare has something to show.
const PLANS: AttemptPlan[] = [
  { seed: 11, holdS: 1.6, trunkDeg: 4, offset: { x: 0.13, z: 0.02 }, sway: 0.014, plie: { bendDeg: 30, devDeg: 9 } },
  { seed: 12, holdS: 2.4, trunkDeg: 2.5, offset: { x: 0.11, z: 0 }, sway: 0.008, plie: { bendDeg: 32, devDeg: 4 } },
  { seed: 13, holdS: 2.0, trunkDeg: 3, offset: { x: 0.12, z: 0.01 }, sway: 0.011, plie: { bendDeg: 28, devDeg: 6 } },
]

// Tracker-like noise without left/right swaps (a front view) and with rare dropouts,
// so a gap or two shows up as a gap.
const NOISE: NoiseModel = { ...MEDIAPIPE_LIKE, swapRate: 0, dropoutRate: 0.004 }

const v = (x: number, y: number, z: number) => ({ x, y, z })

/** The generator only places torso and legs; add a head and low arms for the skeleton. */
function withHeadAndArms(w: Landmark[]): Landmark[] {
  const ls = w[LM.leftShoulder]
  const rs = w[LM.rightShoulder]
  const top = v((ls.x + rs.x) / 2, (ls.y + rs.y) / 2, (ls.z + rs.z) / 2)
  const put = (i: number, p: { x: number; y: number; z: number }) => Object.assign(w[i], p)
  const nose = v(top.x, top.y - 0.2, top.z - 0.08)
  // Face points (1–10) sit around the nose so none is left at the hip origin.
  for (let i = 0; i <= 10; i++) put(i, nose)
  put(LM.leftEar, v(top.x - 0.07, top.y - 0.22, top.z))
  put(LM.rightEar, v(top.x + 0.07, top.y - 0.22, top.z))
  const side = (s: { x: number; y: number; z: number }, dir: number, elbow: number, wrist: number, hand: number[]) => {
    const e = v(s.x + dir * 0.07, s.y + 0.27, s.z - 0.05)
    const h = v(e.x + dir * 0.02, e.y + 0.24, e.z - 0.09)
    put(elbow, e)
    put(wrist, h)
    for (const i of hand) put(i, h)
  }
  side(ls, -1, LM.leftElbow, LM.leftWrist, [17, 19, 21])
  side(rs, 1, LM.rightElbow, LM.rightWrist, [18, 20, 22])
  return w
}

function pose(plan: AttemptPlan, t: number): DancerPose {
  const timing = { ...RELEVE, holdS: plan.holdS }
  const lift = liftProfile(t, timing)
  const plieEnd = timing.riseAt - 0.1
  const plie =
    t > 0.2 && t < plieEnd ? { bendDeg: plan.plie.bendDeg * Math.sin((Math.PI * (t - 0.2)) / (plieEnd - 0.2)), devDeg: plan.plie.devDeg } : null
  // Sway only while up, so the standing frames stay still.
  const up = lift / timing.peak
  return {
    ...NEUTRAL,
    lift,
    trunkDeg: plan.trunkDeg * up,
    offset: { x: plan.offset.x + plan.sway * up * Math.sin(2 * Math.PI * 1.1 * t), z: plan.offset.z * up },
    plie,
  }
}

/**
 * Picture landmarks from the world ones: a front view, the dancer's left on the right
 * of the picture (as MediaPipe reports it), hips a little above the middle.
 */
function project(world: Landmark[]): Landmark[] {
  const s = 0.36 // share of the picture height per metre
  const sx = (s * HEIGHT) / WIDTH
  return world.map((p) => ({ x: 0.5 - p.x * sx, y: 0.5 + p.y * s, z: p.z * s, visibility: p.visibility }))
}

function rawSeries(plan: AttemptPlan): PoseSeries {
  const durationS = RELEVE.riseAt + 2 * RELEVE.riseS + plan.holdS + 2
  const n = Math.round(durationS * FPS)
  const frames: PoseFrame[] = Array.from({ length: n }, (_, i) => {
    const t = i / FPS
    return { t, image: null, world: withHeadAndArms(dancerLandmarks(pose(plan, t))) }
  })
  const exact: PoseSeries = { fps: FPS, durationS: n / FPS, width: WIDTH, height: HEIGHT, model: SAMPLE_MODEL, smoothed: false, frames }
  const noisy = addTrackerNoise(exact, NOISE, plan.seed)
  return { ...noisy, frames: noisy.frames.map((f) => ({ ...f, image: f.world ? project(f.world) : null })) }
}

export interface SampleAttempt {
  /** Shown where a clip name would be; there is no file. */
  clipName: string
  label: string
  /** Smoothed, as the pipeline stores it. */
  series: PoseSeries
  metrics: AttemptMetrics
}

/** The sample attempts, measured by the real engine. Deterministic (seeded). */
export function buildSampleAttempts(): SampleAttempt[] {
  return PLANS.map((plan, i) => {
    const series = smoothSeries(rawSeries(plan))
    return {
      clipName: `Sample attempt ${i + 1} (synthetic)`,
      label: SAMPLE_ATTEMPT_LABEL,
      series,
      metrics: computeMetrics(series, 'releve_balance'),
    }
  })
}
