// End-to-end calibration (scripts/calibrate-metrics.mjs): the raw MediaPipe output of a
// synthetic test clip goes through the app's own steps (unswap + One-Euro smoothing,
// then computeMetrics) one attempt at a time, and each value is set against the truth
// drawn into the clip (clipTruth.ts). Test support only; synthetic clips only.

import { smoothSeries } from '../../pose/oneEuro'
import { LM, type Landmark, type PoseSeries } from '../../pose/types'
import { computeMetrics } from '../engine'
import { segmentPhases } from '../phases'
import { HIPS, LEG, SHOULDERS, mid, sub } from '../signals'
import type { AttemptMetrics, Phase } from '../types'
import { clipTruth, legLength2D, medianOver, pelvisOffset, sliceTruth, trunkDeg, trunkSignedDeg } from './clipTruth'

const DEG = 180 / Math.PI

const median = (xs: number[]) => {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

export interface AttemptRow {
  clip: string
  attempt: number
  metrics: AttemptMetrics
  support: 'left' | 'right' | null
  truth: {
    trunk: number | null
    pelvis: number | null
    balance: number
    onset: number
    holdStart: number
    end: number
    /** Knee flexion the flat drawing implies in 3D at the deepest plié (from foreshortening). */
    plieFlexion3D: number
    maxSwaySpeed: number
    maxOffset: number
  }
  /** Phase boundaries the engine found, seconds from the start of the slice. */
  found: { onset: number | null; holdStart: number | null; end: number | null }
  /** Bias decomposition on the engine's hold + finish frames. */
  parts: {
    /** Median signed sideways (picture-plane) trunk angle, measured − true, degrees. */
    trunkSideErr: number | null
    /** Median |depth-plane| trunk angle, degrees (truth: 0, the figure is flat). */
    trunkDepthAbs: number | null
    /** Same, while standing in the first second (truth: 0 and 0). */
    standingSide: number | null
    standingDepthAbs: number | null
    /** Pelvis offset to each ankle from x alone and from x and z, in leg lengths. */
    pelvisLeftX: number | null
    pelvisRightX: number | null
    pelvisLeftXZ: number | null
    pelvisRightXZ: number | null
    /** World leg length over picture leg length (metres per body height). */
    worldLeg: number | null
    /** Largest knee flexion the tracker reports in prep, degrees. */
    maxFlexion: number | null
    /** Hip-over-ankle speed in the engine's hold (0.2 s base, m/s): median from x and z,
     *  from x alone and from z alone, and the share of hold frames at 0.15 m/s or more. */
    speedXZ: number | null
    speedX: number | null
    speedZ: number | null
    fastXZ: number | null
    fastX: number | null
  }
}

function slice(series: PoseSeries, i0: number, i1: number): PoseSeries {
  const t0 = series.frames[i0].t
  const frames = series.frames.slice(i0, i1).map((f) => ({ ...f, t: f.t - t0 }))
  return { ...series, durationS: frames.length / series.fps, frames }
}

const framesIn = (m: AttemptMetrics, fps: number, phases: Phase[]) => {
  const out: number[] = []
  for (const p of m.phases) {
    if (!phases.includes(p.phase)) continue
    for (let i = Math.round(p.start * fps); i < Math.round(p.end * fps); i++) out.push(i)
  }
  return out
}

export function evaluateClip(raw: PoseSeries, seed: number, variation: number): AttemptRow[] {
  const truth = clipTruth(seed, variation)
  const fps = truth.fps
  if (Math.abs(raw.fps - fps) > 1e-9) throw new Error(`Expected ${fps} fps, got ${raw.fps}.`)
  const rows: AttemptRow[] = []
  for (const a of truth.attempts) {
    const pts = truth.frames.slice(a.i0, a.i1)
    const st = sliceTruth(pts, fps)
    const series = smoothSeries(slice(raw, a.i0, Math.min(a.i1, raw.frames.length)))
    const m = computeMetrics(series, 'releve_balance')
    const seg = segmentPhases(series, 'releve_balance')
    const support = seg.support
    const hf = framesIn(m, fps, ['hold', 'finish']).filter((i) => i < pts.length)
    const leg = st.legLength
    const at = (phase: Phase) => m.phases.find((p) => p.phase === phase)?.start ?? null

    // Standing shin and thigh in the picture, to read the plié depth from foreshortening.
    const standShin = median(pts.slice(0, fps).map((p) => Math.hypot(p.leftKnee[0] - p.leftAnkle[0], p.leftKnee[1] - p.leftAnkle[1]))) as number
    const standThigh = median(pts.slice(0, fps).map((p) => Math.hypot(p.leftHip[0] - p.leftKnee[0], p.leftHip[1] - p.leftKnee[1]))) as number
    let plie = 0
    for (const p of pts) {
      const shin = Math.min(1, Math.hypot(p.leftKnee[0] - p.leftAnkle[0], p.leftKnee[1] - p.leftAnkle[1]) / standShin)
      const thigh = Math.min(1, Math.hypot(p.leftHip[0] - p.leftKnee[0], p.leftHip[1] - p.leftKnee[1]) / standThigh)
      // Thigh and shin tilt forward out of the picture by acos(projected / true length).
      plie = Math.max(plie, (Math.acos(shin) + Math.acos(thigh)) * DEG)
    }

    // Decomposition on the tracker's world landmarks.
    const w = (i: number) => series.frames[i]?.world as Landmark[] | null
    const trunkParts = (idx: number[]) => {
      const side: number[] = []
      const depth: number[] = []
      for (const i of idx) {
        const W = w(i)
        if (!W) continue
        const v = sub(mid(W[SHOULDERS[0]], W[SHOULDERS[1]]), mid(W[HIPS[0]], W[HIPS[1]]))
        // MediaPipe world x grows to the image right = the dancer's left in a front view,
        // the same direction as the picture x of the generator.
        side.push(Math.atan2(v.x, -v.y) * DEG - trunkSignedDeg(pts[i]))
        depth.push(Math.abs(Math.atan2(v.z, -v.y) * DEG))
      }
      return { side: median(side), depth: median(depth) }
    }
    const hold = trunkParts(hf)
    const standing = trunkParts(Array.from({ length: fps }, (_, i) => i))
    const pelvisTo = (s: 'left' | 'right', withZ: boolean) => {
      const len = seg.legLength
      if (!len) return null
      const vals: number[] = []
      for (const i of hf) {
        const W = w(i)
        if (!W) continue
        const h = mid(W[LM.leftHip], W[LM.rightHip])
        const an = W[LEG[s].ankle]
        vals.push((withZ ? Math.hypot(h.x - an.x, h.z - an.z) : Math.abs(h.x - an.x)) / len)
      }
      return median(vals)
    }
    let maxFlex: number | null = null
    for (const p of m.phases.filter((q) => q.phase === 'prep')) {
      for (let i = Math.round(p.start * fps); i < Math.round(p.end * fps); i++) {
        const W = w(i)
        if (!W || !support) continue
        const L = LEG[support]
        const u = sub(W[L.hip], W[L.knee])
        const v = sub(W[L.ankle], W[L.knee])
        const cos = (u.x * v.x + u.y * v.y + u.z * v.z) / (Math.hypot(u.x, u.y, u.z) * Math.hypot(v.x, v.y, v.z))
        const flex = 180 - Math.acos(Math.max(-1, Math.min(1, cos))) * DEG
        maxFlex = maxFlex === null ? flex : Math.max(maxFlex, flex)
      }
    }

    // Speed in the hold, split by axis (the engine uses x and z together).
    const holdFrames = framesIn(m, fps, ['hold'])
    const sx: number[] = []
    const sz: number[] = []
    const sxz: number[] = []
    const half = Math.round(0.1 * fps)
    const vec = (i: number) => {
      const W = w(i)
      if (!W || !support) return null
      const h = mid(W[LM.leftHip], W[LM.rightHip])
      const an = W[LEG[support].ankle]
      return { x: h.x - an.x, z: h.z - an.z }
    }
    for (const i of holdFrames) {
      const a = vec(i - half)
      const b = vec(i + half)
      if (!a || !b) continue
      const dt = (2 * half) / fps
      sx.push(Math.abs(b.x - a.x) / dt)
      sz.push(Math.abs(b.z - a.z) / dt)
      sxz.push(Math.hypot(b.x - a.x, b.z - a.z) / dt)
    }
    const share = (xs: number[]) => (xs.length ? xs.filter((v) => v >= 0.15).length / xs.length : null)

    rows.push({
      clip: `${seed}-${variation}`,
      attempt: a.index,
      metrics: m,
      support,
      truth: {
        trunk: medianOver(pts, hf, trunkDeg),
        pelvis: support ? medianOver(pts, hf, (p) => pelvisOffset(p, support, legLength2D(p, support))) : null,
        balance: st.balanceS,
        onset: st.onset / fps,
        holdStart: st.holdStart / fps,
        end: st.end / fps,
        plieFlexion3D: plie,
        maxSwaySpeed: st.maxSwaySpeed,
        maxOffset: st.maxOffset,
      },
      found: { onset: at('rise'), holdStart: at('hold'), end: at('finish') },
      parts: {
        trunkSideErr: hold.side,
        trunkDepthAbs: hold.depth,
        standingSide: standing.side,
        standingDepthAbs: standing.depth,
        pelvisLeftX: pelvisTo('left', false),
        pelvisRightX: pelvisTo('right', false),
        pelvisLeftXZ: pelvisTo('left', true),
        pelvisRightXZ: pelvisTo('right', true),
        worldLeg: seg.legLength !== null ? seg.legLength / leg : null,
        maxFlexion: maxFlex,
        speedXZ: median(sxz),
        speedX: median(sx),
        speedZ: median(sz),
        fastXZ: share(sxz),
        fastX: share(sx),
      },
    })
  }
  return rows
}
