// Parallel feet (mentor review, task 14; teacher interview: "parallel feet"). Shared by the
// relevé engine (metric `feet_angle_deg`, engine.ts) and the phrase engine (theme
// `parallel_feet`, phrase.ts). Describes; never grades: 0° is parallel, and the sign only says
// which way the feet open.
//
// Depth: from one camera the heel → toe direction is mostly the tracker's depth guess (a
// front camera looks straight along the feet), the same signal that made knees over toes not
// follow the multi-camera reference (CALIBRATION.md). Both engines therefore cap this value at
// low confidence until it is checked against that reference.

import type { Landmark } from '../pose/types'
import { HIPS, LEG, seen, sub } from './signals'

const DEG = 180 / Math.PI

/** Below 1 cm of horizontal length a foot direction is tracking noise, not a direction. */
export const MIN_FOOT_M = 0.01

/** Landmarks the angle needs: both heels, both toes and both hips (for the sign). */
export const FEET_LANDMARKS = [LEG.left.heel, LEG.left.toe, LEG.right.heel, LEG.right.toe, ...HIPS] as const

/**
 * Signed angle between the two feet seen from above, in degrees, −180..180.
 *
 * Each foot direction is heel → toe projected on the floor plane (x, z of the world
 * landmarks). The size is the angle between the two directions. The sign comes from the hip
 * line: > 0 when the toes point away from each other (feet open, turned out), < 0 when they
 * point towards each other (turned in), 0 when parallel. Swapping the left/right labels swaps
 * the hips as well, so a label swap does not flip the sign.
 *
 * Null when a landmark is not tracked or a foot direction is shorter than MIN_FOOT_M.
 */
export function feetAngleDeg(w: Landmark[] | null): number | null {
  if (!seen(w, FEET_LANDMARKS)) return null
  const unit = (heel: number, toe: number) => {
    const f = sub(w[toe], w[heel])
    const l = Math.hypot(f.x, f.z)
    return l < MIN_FOOT_M ? null : { x: f.x / l, z: f.z / l }
  }
  const l = unit(LEG.left.heel, LEG.left.toe)
  const r = unit(LEG.right.heel, LEG.right.toe)
  if (!l || !r) return null
  const lat = sub(w[LEG.right.hip], w[LEG.left.hip])
  const latLen = Math.hypot(lat.x, lat.z)
  if (!(latLen > 1e-9)) return null
  const dot = Math.max(-1, Math.min(1, l.x * r.x + l.z * r.z))
  const size = Math.acos(dot) * DEG
  // Toes opening: the right foot points more to the right (+lat) than the left one does.
  const open = ((r.x - l.x) * lat.x + (r.z - l.z) * lat.z) / latLen
  return open < 0 ? -size : size
}
