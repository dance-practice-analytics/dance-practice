// Known-answer synthetic dancer for calibrating the metrics engine. Also used by the v2
// "Try with a sample session" button (src/v2/sample.ts, loaded on demand). Every number
// is made up: no footage, no participant.
//
// The generator places the landmarks the engine reads in MediaPipe's world frame
// (metres, origin at the hip midpoint, y down, feet pointing to -z) with exact geometry,
// so each metric has a known answer:
//   - trunk: the hip-midpoint → shoulder-midpoint vector is `trunkDeg` from vertical;
//   - pelvis: the hip midpoint is `offset` (horizontal, metres) from the supporting ankle;
//   - legs: thigh and shin are exactly THIGH and SHIN long in every frame (2-link IK);
//   - knee: in a plié the knee bends `bendDeg` (180° − hip–knee–ankle angle) towards a
//     horizontal direction `devDeg` away from the foot direction;
//   - heel: `lift` × leg length above its own toe;
//   - yaw: the whole body turns `yawDeg` about the vertical axis through the hip midpoint.
// Then `addTrackerNoise` degrades it the way MediaPipe output is degraded (white jitter
// plus slow drift, depth worse than x/y, weakly visible feet, dropped frames, left/right
// shoulder swaps), and the caller runs the same One-Euro smoothing as the app.

import { LANDMARK_COUNT, LM, type Landmark, type PoseFrame, type PoseSeries } from '../../pose/types'

export const THIGH = 0.45
export const SHIN = 0.45
export const LEG = THIGH + SHIN
/** Half the distance between the hip joints and between the feet (parallel position). */
export const HIP_HALF = 0.1
const TRUNK = 0.5
const SHOULDER_HALF = 0.18
const ANKLE_HEIGHT = 0.07
const HEEL_BACK = 0.05
const TOE_FORWARD = 0.15
const RAD = Math.PI / 180

export interface DancerPose {
  /** Heel height above its toe as a share of leg length (both feet, unless `retire`). */
  lift: number
  /** Trunk angle from vertical, degrees. */
  trunkDeg: number
  /** Direction of the lean in the horizontal plane: 0 = +x (sideways), 90 = +z (backwards). */
  trunkAzDeg: number
  /** Hip midpoint minus supporting (left) ankle, horizontal, metres. */
  offset: { x: number; z: number }
  /** Knee flexion and the knee direction's horizontal angle away from the foot direction. */
  plie: { bendDeg: number; devDeg: number } | null
  /** Body yaw about the vertical axis, degrees. */
  yawDeg: number
  /** Right foot drawn up to the left knee (pirouette working leg). */
  retire: boolean
}

export const NEUTRAL: DancerPose = {
  lift: 0,
  trunkDeg: 0,
  trunkAzDeg: 0,
  offset: { x: HIP_HALF, z: 0 },
  plie: null,
  yawDeg: 0,
  retire: false,
}

type V = { x: number; y: number; z: number }
const v = (x: number, y: number, z: number): V => ({ x, y, z })
const add = (a: V, b: V): V => v(a.x + b.x, a.y + b.y, a.z + b.z)
const sub = (a: V, b: V): V => v(a.x - b.x, a.y - b.y, a.z - b.z)
const scale = (a: V, k: number): V => v(a.x * k, a.y * k, a.z * k)
const dot = (a: V, b: V) => a.x * b.x + a.y * b.y + a.z * b.z
const len = (a: V) => Math.hypot(a.x, a.y, a.z)
const unit = (a: V) => scale(a, 1 / len(a))

/** Knee of a leg from hip to ankle bending towards `towards` (projected off the leg axis). */
function knee(hip: V, ankle: V, towards: V): V {
  const axis = sub(ankle, hip)
  const d = len(axis)
  const half = Math.min(d / 2, THIGH)
  const h = Math.sqrt(Math.max(0, THIGH * THIGH - half * half))
  const a = unit(axis)
  const perp = sub(towards, scale(a, dot(towards, a)))
  const p = len(perp) > 1e-9 ? unit(perp) : v(0, 0, -1)
  return add(add(hip, scale(a, half)), scale(p, h))
}

/** World landmarks of one exact pose (visibility 1). */
export function dancerLandmarks(p: DancerPose): Landmark[] {
  const w: Landmark[] = Array.from({ length: LANDMARK_COUNT }, () => ({ x: 0, y: 0, z: 0, visibility: 1 }))
  const put = (i: number, q: V) => Object.assign(w[i], q)

  const lh = v(-HIP_HALF, 0, 0)
  const rh = v(HIP_HALF, 0, 0)
  // Hip-to-ankle distance: the full leg when straight, shortened by the plié.
  const bend = p.plie ? p.plie.bendDeg * RAD : 0
  const reach = LEG * Math.cos(bend / 2)
  const foot = v(0, 0, -1)
  const leg = (hip: V, ankleH: { x: number; z: number }, ki: number, ai: number, hi: number, ti: number) => {
    const hx = ankleH.x - hip.x
    const hz = ankleH.z - hip.z
    const ankle = v(ankleH.x, Math.sqrt(Math.max(0, reach * reach - hx * hx - hz * hz)), ankleH.z)
    const dev = (p.plie?.devDeg ?? 0) * RAD
    // Bend direction: the foot direction turned by `dev` towards +x.
    const towards = v(Math.sin(dev), 0, -Math.cos(dev))
    put(ki, knee(hip, ankle, towards))
    put(ai, ankle)
    const toeY = ankle.y + ANKLE_HEIGHT + p.lift * LEG * 0.5
    put(ti, add(v(ankle.x, toeY, ankle.z), scale(foot, TOE_FORWARD)))
    put(hi, add(v(ankle.x, toeY - p.lift * LEG, ankle.z), scale(foot, -HEEL_BACK)))
  }
  const la = { x: -p.offset.x, z: -p.offset.z }
  leg(lh, la, LM.leftKnee, LM.leftAnkle, LM.leftHeel, LM.leftFootIndex)
  leg(rh, { x: la.x + 2 * HIP_HALF, z: la.z }, LM.rightKnee, LM.rightAnkle, LM.rightHeel, LM.rightFootIndex)
  put(LM.leftHip, lh)
  put(LM.rightHip, rh)
  if (p.retire) {
    // Working foot at the supporting knee, knee out to the side.
    const lk = w[LM.leftKnee]
    put(LM.rightKnee, v(HIP_HALF + 0.35, 0.3, -0.15))
    put(LM.rightAnkle, v(lk.x + 0.06, lk.y - 0.02, lk.z))
    put(LM.rightHeel, v(lk.x + 0.04, lk.y, lk.z + 0.03))
    put(LM.rightFootIndex, v(lk.x + 0.12, lk.y + 0.06, lk.z - 0.05))
  }

  const t = p.trunkDeg * RAD
  const az = p.trunkAzDeg * RAD
  const mid = v(TRUNK * Math.sin(t) * Math.cos(az), -TRUNK * Math.cos(t), TRUNK * Math.sin(t) * Math.sin(az))
  put(LM.leftShoulder, add(mid, v(-SHOULDER_HALF, 0, 0)))
  put(LM.rightShoulder, add(mid, v(SHOULDER_HALF, 0, 0)))

  // Turn everything about the vertical axis through the hip midpoint.
  const c = Math.cos(p.yawDeg * RAD)
  const s = Math.sin(p.yawDeg * RAD)
  for (const q of w) {
    const x = q.x * c - q.z * s
    const z = q.x * s + q.z * c
    q.x = x
    q.z = z
  }
  return w
}

export function dancerSeries(at: (t: number, i: number) => DancerPose | null, durationS: number, fps = 30): PoseSeries {
  const n = Math.round(durationS * fps)
  const frames: PoseFrame[] = Array.from({ length: n }, (_, i) => {
    const t = i / fps
    const p = at(t, i)
    return { t, image: null, world: p ? dancerLandmarks(p) : null }
  })
  return { fps, durationS: n / fps, width: 720, height: 1280, model: 'synthetic-dancer', smoothed: false, frames }
}

// ---------- motion profiles ----------

export const smoothstep = (u: number) => {
  const x = Math.min(1, Math.max(0, u))
  return x * x * (3 - 2 * x)
}

export interface ReleveTiming {
  /** Rise starts at this time, s. */
  riseAt: number
  /** Rise and lowering take this long, s (smoothstep). */
  riseS: number
  /** Time at the top between the end of the rise and the start of the lowering, s. */
  holdS: number
  /** Heel height at the top, share of leg length. */
  peak: number
}

export const RELEVE: ReleveTiming = { riseAt: 1.5, riseS: 0.5, holdS: 2, peak: 0.08 }

/** Heel lift at time t for a stand → rise → hold → lower → stand profile. */
export function liftProfile(t: number, r: ReleveTiming = RELEVE): number {
  const up = smoothstep((t - r.riseAt) / r.riseS)
  const down = smoothstep((t - r.riseAt - r.riseS - r.holdS) / r.riseS)
  return r.peak * (up - down)
}

// ---------- tracker noise ----------

/** Small seeded PRNG (mulberry32) so runs repeat. */
export function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface NoiseModel {
  /** White jitter per landmark and frame, metres (x/y and depth z). */
  whiteXY: number
  whiteZ: number
  /** Slow drift (AR(1), time constant `driftTauS`), metres. Shared by the landmarks of one
   *  body segment (each foot with its ankle, each knee, the torso), as in the real output:
   *  a heel drifts by ~8 mm but heel − toe of the same foot hardly drifts. */
  driftXY: number
  driftZ: number
  driftTauS: number
  /** Visibility ranges [min, max] drawn per frame. */
  visTorso: [number, number]
  visLeg: [number, number]
  visFoot: [number, number]
  /** Probability per frame that a run of 1–4 frames without any pose starts. */
  dropoutRate: number
  /** Probability per frame that one toe is reported under the tracking gate. */
  footLossRate: number
  /** Probability per frame, while the shoulder line is within 25° of edge-on, that the
   *  shoulder labels swap for 1–3 frames. */
  swapRate: number
}

/**
 * MediaPipe-like degradation. The magnitudes are not tuned to make the engine pass; they
 * are measured on the real tracker output of the synthetic stick-figure clips while the
 * figure stands still (15 stretches of 3–6 s, raw world landmarks; CALIBRATION.md):
 * heel − toe height std 3–5 mm (frame-to-frame 3–4 mm, so mostly white), heel height
 * 9 mm (white ~5, drift ~8), ankle depth 19 mm (white ~11, drift ~15), shoulder x white
 * ~1–2 mm. Torso visibility ~1, foot visibility 0.3–0.7 as in the real output. Dropouts
 * and swaps are not in that output (a flat figure facing the camera); they are added at
 * rates meant to be pessimistic.
 */
export const MEDIAPIPE_LIKE: NoiseModel = {
  whiteXY: 0.003,
  whiteZ: 0.011,
  driftXY: 0.006,
  driftZ: 0.015,
  driftTauS: 0.5,
  visTorso: [0.92, 1],
  visLeg: [0.55, 0.95],
  visFoot: [0.35, 0.75],
  dropoutRate: 0.01,
  footLossRate: 0.02,
  swapRate: 0.15,
}

export const NO_NOISE: NoiseModel = {
  whiteXY: 0,
  whiteZ: 0,
  driftXY: 0,
  driftZ: 0,
  driftTauS: 0.5,
  visTorso: [1, 1],
  visLeg: [1, 1],
  visFoot: [1, 1],
  dropoutRate: 0,
  footLossRate: 0,
  swapRate: 0,
}

const TORSO = new Set<number>([LM.leftShoulder, LM.rightShoulder, LM.leftHip, LM.rightHip])
const FOOT = new Set<number>([LM.leftHeel, LM.rightHeel, LM.leftFootIndex, LM.rightFootIndex])
/** Drift group of each landmark: 0 torso and everything else, 1/2 left/right foot with its ankle, 3/4 knees. */
const GROUP: Record<number, number> = {
  [LM.leftAnkle]: 1,
  [LM.leftHeel]: 1,
  [LM.leftFootIndex]: 1,
  [LM.rightAnkle]: 2,
  [LM.rightHeel]: 2,
  [LM.rightFootIndex]: 2,
  [LM.leftKnee]: 3,
  [LM.rightKnee]: 4,
}
const GROUPS = 5

/** Returns a degraded copy (the input is not modified). */
export function addTrackerNoise(series: PoseSeries, model: NoiseModel, seed: number): PoseSeries {
  const r = rng(seed)
  const gauss = () => Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r())
  const k = Math.exp(-1 / (model.driftTauS * series.fps))
  const drift = Array.from({ length: GROUPS * 3 }, () => 0)
  const range = ([a, b]: [number, number]) => a + (b - a) * r()
  let dropLeft = 0
  let swapLeft = 0

  const frames = series.frames.map((f) => {
    // Drift evolves in every frame, tracked or not.
    for (let j = 0; j < drift.length; j++) {
      const sd = j % 3 === 2 ? model.driftZ : model.driftXY
      drift[j] = k * drift[j] + Math.sqrt(1 - k * k) * sd * gauss()
    }
    if (dropLeft > 0 || r() < model.dropoutRate) {
      dropLeft = dropLeft > 0 ? dropLeft - 1 : Math.floor(r() * 4)
      return { t: f.t, image: null, world: null }
    }
    if (!f.world) return { t: f.t, image: null, world: null }
    const world = f.world.map((p, i) => ({
      x: p.x + model.whiteXY * gauss() + drift[(GROUP[i] ?? 0) * 3],
      y: p.y + model.whiteXY * gauss() + drift[(GROUP[i] ?? 0) * 3 + 1],
      z: p.z + model.whiteZ * gauss() + drift[(GROUP[i] ?? 0) * 3 + 2],
      visibility: TORSO.has(i) ? range(model.visTorso) : FOOT.has(i) ? range(model.visFoot) : range(model.visLeg),
    }))
    if (r() < model.footLossRate) world[r() < 0.5 ? LM.leftFootIndex : LM.rightFootIndex].visibility = 0.1 + 0.15 * r()

    const l = f.world[LM.leftShoulder]
    const rs = f.world[LM.rightShoulder]
    const edgeOn = Math.abs(Math.cos(Math.atan2(rs.z - l.z, rs.x - l.x))) < Math.sin(25 * RAD)
    if (swapLeft > 0 || (edgeOn && r() < model.swapRate)) {
      swapLeft = swapLeft > 0 ? swapLeft - 1 : Math.floor(r() * 3)
      const a = world[LM.leftShoulder]
      world[LM.leftShoulder] = world[LM.rightShoulder]
      world[LM.rightShoulder] = a
    }
    return { t: f.t, image: null, world }
  })
  return { ...series, frames }
}
