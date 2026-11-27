// Angle guides on the stage (mentor review, change 4): optional lines and values drawn over
// the skeleton for the frame on screen, one toggle each. Every value uses the same formula as
// the measurement it belongs to, on the world landmarks; the lines are drawn on the picture
// landmarks. The measurements summarise these per-frame values over a phase or the clip.
// Values only: no target, no colour for better or worse.

import { neckAngleDeg, signedKneeDev } from '../../../metrics/expressive'
import { feetAngleDeg } from '../../../metrics/feet'
import { median, mid, norm, seen, sub } from '../../../metrics/signals'
import { LM, type Landmark, type PoseFrame, type PoseSeries } from '../../../pose/types'
import { trunkAt } from './timeline'

export const GUIDE_KEYS = ['trunk', 'head', 'knees', 'arms', 'feet'] as const
export type GuideKey = (typeof GUIDE_KEYS)[number]

export const GUIDE_LABELS: Record<GuideKey, string> = {
  trunk: 'Torso lean',
  head: 'Head',
  knees: 'Knees over toes',
  arms: 'Arm reach',
  feet: 'Parallel feet',
}

/** What each guide shows, for its tooltip. */
export const GUIDE_ABOUT: Record<GuideKey, string> = {
  trunk: 'Angle of the hips-to-shoulders line from the vertical.',
  head: 'Angle of the head (ears) against the hips-to-shoulders line.',
  knees: 'On a bent knee: where the knee points against the foot line, seen from above (inside or outside). Depends on depth.',
  arms: 'Distance from the middle of the shoulders to each wrist, in arm lengths (distal expansion).',
  feet: 'Angle between the two feet seen from above (0° parallel). Depends on depth.',
}

/** Guides whose value comes mostly from the pose model's depth estimate: drawn dashed, read as rough. */
export const DEPTH_GUIDES: ReadonlySet<GuideKey> = new Set(['knees', 'feet'])

export interface GuideReadings {
  trunk: number | null
  head: number | null
  knees: { left: number | null; right: number | null }
  arms: { left: number | null; right: number | null }
  feet: number | null
}

const ARM = {
  left: [LM.leftShoulder, LM.leftElbow, LM.leftWrist],
  right: [LM.rightShoulder, LM.rightElbow, LM.rightWrist],
} as const

/** The clip's arm length per side (median shoulder–elbow–wrist), as the arm reach theme scales it. */
export function armLengths(series: PoseSeries | null): { left: number | null; right: number | null } {
  const out = { left: null as number | null, right: null as number | null }
  if (!series) return out
  for (const s of ['left', 'right'] as const) {
    const [sh, el, wr] = ARM[s]
    const lens: number[] = []
    for (const f of series.frames) {
      if (seen(f.world, [sh, el, wr, LM.leftShoulder, LM.rightShoulder])) lens.push(norm(sub(f.world[sh], f.world[el])) + norm(sub(f.world[el], f.world[wr])))
    }
    out[s] = median(lens)
  }
  return out
}

function reach(w: Landmark[] | null, side: 'left' | 'right', arm: number | null): number | null {
  const [sh, el, wr] = ARM[side]
  if (!arm || !seen(w, [sh, el, wr, LM.leftShoulder, LM.rightShoulder])) return null
  return norm(sub(w[wr], mid(w[LM.leftShoulder], w[LM.rightShoulder]))) / arm
}

/** Every guide's value for one frame; null where its landmarks aren't seen (or, for knees, the knee is straight). */
export function guideReadings(frame: PoseFrame | null | undefined, arm: { left: number | null; right: number | null }): GuideReadings {
  const w = frame?.world ?? null
  return {
    trunk: frame ? (trunkAt(frame)?.v ?? null) : null,
    head: neckAngleDeg(w),
    knees: { left: w ? signedKneeDev(w, 'left') : null, right: w ? signedKneeDev(w, 'right') : null },
    arms: { left: reach(w, 'left', arm.left), right: reach(w, 'right', arm.right) },
    feet: feetAngleDeg(w),
  }
}

// ---------- labels ----------

export const degText = (v: number) => `${Math.round(Math.abs(v))}°`

/** Knee: '8° inside', '5° outside', 'in line' (+ = inside, as the theme). */
export function kneeText(v: number): string {
  if (Math.round(Math.abs(v)) === 0) return 'in line'
  return `${degText(v)} ${v > 0 ? 'inside' : 'outside'}`
}

/** Feet: 'parallel', '12° apart', '4° towards each other' (+ = toes apart, as the measurement). */
export function feetText(v: number): string {
  if (Math.round(Math.abs(v)) === 0) return 'parallel'
  return `${degText(v)} ${v > 0 ? 'apart' : 'towards each other'}`
}

export const reachText = (v: number) => `${v.toFixed(2)}×`
