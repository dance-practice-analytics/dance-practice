import { describe, expect, it } from 'vitest'
import { LANDMARK_COUNT, LM, type Landmark } from '../pose/types'
import { feetAngleDeg, MIN_FOOT_M } from './feet'

// Synthetic feet only (no real footage). Hip-centred, y down, metres; hips 0.2 m apart, the
// dancer faces −z. `left` / `right` turn each foot outwards by that many degrees (negative = inwards).
const RAD = Math.PI / 180

function stance(left: number, right: number, opts: { facing?: number; vis?: number; footLen?: number } = {}): Landmark[] {
  const w: Landmark[] = Array.from({ length: LANDMARK_COUNT }, () => ({ x: 0, y: 0, z: 0, visibility: opts.vis ?? 1 }))
  const yaw = (opts.facing ?? 0) * RAD
  // Rotate the whole body about the vertical axis (the dancer turns to face another way).
  const put = (i: number, x: number, y: number, z: number) =>
    Object.assign(w[i], { x: x * Math.cos(yaw) - z * Math.sin(yaw), y, z: x * Math.sin(yaw) + z * Math.cos(yaw) })
  const len = opts.footLen ?? 0.2
  put(LM.leftHip, -0.1, 0, 0)
  put(LM.rightHip, 0.1, 0, 0)
  // Outwards is −x for the left foot and +x for the right one.
  put(LM.leftHeel, -0.1, 0.95, 0.05)
  put(LM.leftFootIndex, -0.1 - len * Math.sin(left * RAD), 0.95, 0.05 - len * Math.cos(left * RAD))
  put(LM.rightHeel, 0.1, 0.95, 0.05)
  put(LM.rightFootIndex, 0.1 + len * Math.sin(right * RAD), 0.95, 0.05 - len * Math.cos(right * RAD))
  return w
}

/** The tracker swaps every left/right label (e.g. while the dancer faces away). */
function swapped(w: Landmark[]): Landmark[] {
  const out = w.map((l) => ({ ...l }))
  for (const [a, b] of [
    [LM.leftHip, LM.rightHip],
    [LM.leftHeel, LM.rightHeel],
    [LM.leftFootIndex, LM.rightFootIndex],
  ]) {
    out[a] = { ...w[b] }
    out[b] = { ...w[a] }
  }
  return out
}

describe('feetAngleDeg (parallel feet)', () => {
  it('reads 0 for parallel feet', () => {
    expect(feetAngleDeg(stance(0, 0))).toBeCloseTo(0, 6)
  })

  it('is positive when the toes point apart and negative when they point towards each other', () => {
    expect(feetAngleDeg(stance(10, 10))).toBeCloseTo(20, 6)
    expect(feetAngleDeg(stance(-8, -8))).toBeCloseTo(-16, 6)
    // One foot turned, the other parallel: the angle is between the two feet.
    expect(feetAngleDeg(stance(0, 15))).toBeCloseTo(15, 6)
    expect(feetAngleDeg(stance(-12, 0))).toBeCloseTo(-12, 6)
  })

  it('does not depend on where the dancer faces', () => {
    for (const facing of [30, 90, 180, -135]) expect(feetAngleDeg(stance(10, 10, { facing }))).toBeCloseTo(20, 6)
  })

  it('keeps its sign when the tracker swaps left and right', () => {
    expect(feetAngleDeg(swapped(stance(10, 10)))).toBeCloseTo(20, 6)
    expect(feetAngleDeg(swapped(stance(-8, -8)))).toBeCloseTo(-16, 6)
  })

  it('both feet turned the same way are still parallel to each other', () => {
    // Left foot outwards 10°, right foot inwards 10°: both point 10° to the dancer's left.
    expect(feetAngleDeg(stance(10, -10))).toBeCloseTo(0, 6)
  })

  it('is null without tracking or without a foot direction, never 0', () => {
    expect(feetAngleDeg(null)).toBeNull()
    expect(feetAngleDeg(stance(0, 0, { vis: 0.1 }))).toBeNull()
    // A foot seen end-on (heel and toe at the same floor point) has no direction.
    expect(feetAngleDeg(stance(0, 0, { footLen: MIN_FOOT_M / 2 }))).toBeNull()
  })
})
