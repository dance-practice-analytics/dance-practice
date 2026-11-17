// Known-answer synthetic dancer for the phrase modules (events.ts, expressive.ts). Unlike
// syntheticDancer.ts (legs and trunk only, mirrored left/right, which the relevé metrics do
// not care about), this one has a head and arms and real handedness, because direction,
// knee side and head lead depend on it. Every number is made up: no footage, no participant.
//
// MediaPipe world frame: metres, origin at the hip midpoint, x to image right, y down,
// z away from the camera. At yaw 0 the dancer faces the camera: front F = −z, the dancer's
// right R = −x (image left), up U = −y. Yaw turns the body about the vertical axis.

import { LANDMARK_COUNT, LM, type Landmark, type PoseFrame, type PoseSeries } from '../../pose/types'

export const THIGH = 0.45
export const SHIN = 0.45
export const LEG = THIGH + SHIN
export const UPPER_ARM = 0.3
export const FOREARM = 0.27
export const ARM = UPPER_ARM + FOREARM
export const HIP_HALF = 0.1
const SHOULDER_HALF = 0.18
const TRUNK = 0.5
const NECK = 0.22
const RAD = Math.PI / 180

type V = { x: number; y: number; z: number }
const v = (x: number, y: number, z: number): V => ({ x, y, z })
const add = (...a: V[]): V => a.reduce((s, b) => v(s.x + b.x, s.y + b.y, s.z + b.z), v(0, 0, 0))
const sc = (a: V, k: number): V => v(a.x * k, a.y * k, a.z * k)
const dot = (a: V, b: V) => a.x * b.x + a.y * b.y + a.z * b.z
const cross = (a: V, b: V): V => v(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x)
const len = (a: V) => Math.hypot(a.x, a.y, a.z)
const unit = (a: V) => sc(a, 1 / len(a))

export type Side = 'left' | 'right'

export interface Gesture {
  side: Side
  /** Hip → ankle angle from straight down, deg. */
  elevDeg: number
  /** Direction in the pelvis frame: 0 front, 90 towards the leg's own side, 180 back. */
  azDeg: number
  /** Knee flexion of the working leg, deg. */
  kneeDeg?: number
}

export interface ArmPose {
  /** Direction of shoulder → wrist in (front, outwards, up) body coordinates; normalised here. */
  dir: [number, number, number]
  /** Elbow flexion, deg (0 = straight). */
  bendDeg?: number
}

export interface PhrasePose {
  yawDeg: number
  /** Both-feet plié, knee flexion in deg. */
  plieDeg: number
  /** Foot turnout from the front, deg (each foot outwards). */
  turnoutDeg: number
  /** Knee direction rotated medially (inwards) from the foot line, deg; negative = outwards. */
  kneeDevDeg: number
  /** Heel lift above the toe, share of leg length (both supporting feet). */
  heelLift: number
  /** One leg off the floor. */
  gesture: Gesture | null
  trunkDeg: number
  /** 0 = forward, 90 = towards the dancer's right. */
  trunkAzDeg: number
  /** Head flexion from the trunk line towards the chest, deg (negative = extension). */
  headFlexDeg: number
  arms: { left: ArmPose; right: ArmPose }
}

export const STAND: PhrasePose = {
  yawDeg: 0,
  plieDeg: 0,
  turnoutDeg: 0,
  kneeDevDeg: 0,
  heelLift: 0,
  gesture: null,
  trunkDeg: 0,
  trunkAzDeg: 0,
  headFlexDeg: 0,
  arms: { left: { dir: [0, 0.2, -1] }, right: { dir: [0, 0.2, -1] } },
}

export function phraseLandmarks(p: PhrasePose): Landmark[] {
  const w: Landmark[] = Array.from({ length: LANDMARK_COUNT }, () => ({ x: 0, y: 0, z: 0, visibility: 1 }))
  const put = (i: number, q: V) => Object.assign(w[i], q)
  const psi = p.yawDeg * RAD
  const F = v(-Math.sin(psi), 0, -Math.cos(psi))
  const R = v(-Math.cos(psi), 0, Math.sin(psi))
  const U = v(0, -1, 0)
  const out = (s: Side) => (s === 'right' ? R : sc(R, -1))
  const body = (f: number, r: number, u: number) => add(sc(F, f), sc(R, r), sc(U, u))

  const legIdx = {
    left: { hip: LM.leftHip, knee: LM.leftKnee, ankle: LM.leftAnkle, heel: LM.leftHeel, toe: LM.leftFootIndex },
    right: { hip: LM.rightHip, knee: LM.rightKnee, ankle: LM.rightAnkle, heel: LM.rightHeel, toe: LM.rightFootIndex },
  }
  for (const s of ['left', 'right'] as const) {
    const id = legIdx[s]
    const hip = sc(out(s), HIP_HALF)
    put(id.hip, hip)
    const g = p.gesture && p.gesture.side === s ? p.gesture : null
    if (g) {
      const e = g.elevDeg * RAD
      const a = g.azDeg * RAD
      const d = add(sc(U, -Math.cos(e)), sc(add(sc(F, Math.cos(a)), sc(out(s), Math.sin(a))), Math.sin(e)))
      const reach = LEG * Math.cos(((g.kneeDeg ?? 0) * RAD) / 2)
      const ankle = add(hip, sc(d, reach))
      const h = Math.sqrt(Math.max(0, THIGH * THIGH - (reach / 2) ** 2))
      const perp0 = add(U, sc(d, -dot(U, d)))
      const perp = len(perp0) > 1e-6 ? unit(perp0) : F
      put(id.knee, add(hip, sc(d, reach / 2), sc(perp, h)))
      put(id.ankle, ankle)
      put(id.toe, add(ankle, sc(d, 0.15)))
      put(id.heel, add(ankle, sc(d, -0.03), sc(perp, 0.05)))
      continue
    }
    const reach = LEG * Math.cos((p.plieDeg * RAD) / 2)
    const ankle = add(hip, sc(U, -reach))
    const tau = p.turnoutDeg * RAD
    const foot = add(sc(F, Math.cos(tau)), sc(out(s), Math.sin(tau)))
    const kd = (p.turnoutDeg - p.kneeDevDeg) * RAD
    const kneeDir = add(sc(F, Math.cos(kd)), sc(out(s), Math.sin(kd)))
    const h = Math.sqrt(Math.max(0, THIGH * THIGH - (reach / 2) ** 2))
    put(id.knee, add(hip, sc(U, -reach / 2), sc(kneeDir, h)))
    put(id.ankle, ankle)
    const floor = add(ankle, sc(U, -0.07))
    put(id.toe, add(floor, sc(foot, 0.15)))
    put(id.heel, add(floor, sc(foot, -0.05), sc(U, p.heelLift * LEG)))
  }

  // Trunk, shoulders, head.
  const t = p.trunkDeg * RAD
  const ta = p.trunkAzDeg * RAD
  const tdir = add(sc(U, Math.cos(t)), sc(add(sc(F, Math.cos(ta)), sc(R, Math.sin(ta))), Math.sin(t)))
  const sm = sc(tdir, TRUNK)
  put(LM.leftShoulder, add(sm, sc(R, -SHOULDER_HALF)))
  put(LM.rightShoulder, add(sm, sc(R, SHOULDER_HALF)))
  const chest = unit(cross(tdir, R))
  const hf = p.headFlexDeg * RAD
  const hdir = add(sc(tdir, Math.cos(hf)), sc(chest, Math.sin(hf)))
  const earMid = add(sm, sc(hdir, NECK))
  put(LM.leftEar, add(earMid, sc(R, -0.07)))
  put(LM.rightEar, add(earMid, sc(R, 0.07)))
  const face = add(sc(chest, Math.cos(hf)), sc(tdir, -Math.sin(hf)))
  put(LM.nose, add(earMid, sc(face, 0.1)))

  for (const s of ['left', 'right'] as const) {
    const a = p.arms[s]
    const sh = w[s === 'left' ? LM.leftShoulder : LM.rightShoulder]
    const d = unit(body(a.dir[0], (s === 'right' ? 1 : -1) * a.dir[1], a.dir[2]))
    const reach = Math.sqrt(UPPER_ARM ** 2 + FOREARM ** 2 + 2 * UPPER_ARM * FOREARM * Math.cos((a.bendDeg ?? 0) * RAD))
    const wrist = add(sh, sc(d, reach))
    const cosA = (UPPER_ARM ** 2 + reach ** 2 - FOREARM ** 2) / (2 * UPPER_ARM * reach)
    const along = UPPER_ARM * cosA
    const off = Math.sqrt(Math.max(0, UPPER_ARM ** 2 - along ** 2))
    const perp0 = add(F, sc(d, -dot(F, d)))
    const perp = len(perp0) > 1e-6 ? unit(perp0) : U
    put(s === 'left' ? LM.leftElbow : LM.rightElbow, add(sh, sc(d, along), sc(perp, -off)))
    put(s === 'left' ? LM.leftWrist : LM.rightWrist, wrist)
  }
  return w
}

/** Orthographic front-camera picture of the world landmarks (x right, y down, frame units). */
export function frontImage(world: Landmark[]): Landmark[] {
  return world.map((q) => ({ x: 0.5 + q.x * 0.35, y: 0.55 + q.y * 0.35, z: q.z * 0.35, visibility: q.visibility }))
}

export function phraseSeries(at: (t: number) => PhrasePose, durationS: number, fps = 30): PoseSeries {
  const n = Math.round(durationS * fps)
  const frames: PoseFrame[] = Array.from({ length: n }, (_, i) => {
    const t = i / fps
    const world = phraseLandmarks(at(t))
    return { t, image: frontImage(world), world }
  })
  return { fps, durationS: n / fps, width: 1080, height: 1080, model: 'synthetic-phrase', smoothed: false, frames }
}

/** 0 → 1 → 0 window: ramps up over `ramp` s from `a`, holds, ramps down to end at `b`. */
export function bump(t: number, a: number, b: number, ramp = 0.3): number {
  const s = (u: number) => {
    const x = Math.min(1, Math.max(0, u))
    return x * x * (3 - 2 * x)
  }
  return s((t - a) / ramp) - s((t - (b - ramp)) / ramp)
}
