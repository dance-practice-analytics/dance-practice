import { describe, expect, it } from 'vitest'
import { headTrunk } from '../../../metrics/expressive'
import { dancerLandmarks, NEUTRAL } from '../../../metrics/testing/syntheticDancer'
import { LM, type Landmark, type PoseFrame, type PoseSeries } from '../../../pose/types'
import { armLengths, feetText, guideReadings, kneeText, reachText } from './guides'

const RAD = Math.PI / 180

/** The synthetic dancer plus a head tilted `headDeg` forward from the trunk line and the right arm straight out to the side. */
function pose(extra: Partial<typeof NEUTRAL> = {}, headDeg = 0): Landmark[] {
  const w = dancerLandmarks({ ...NEUTRAL, ...extra })
  const sm = { x: (w[LM.leftShoulder].x + w[LM.rightShoulder].x) / 2, y: (w[LM.leftShoulder].y + w[LM.rightShoulder].y) / 2, z: (w[LM.leftShoulder].z + w[LM.rightShoulder].z) / 2 }
  // Upright trunk: head 0.2 m up from the shoulders, tilted towards -z by headDeg.
  const ear = { x: 0, y: sm.y - 0.2 * Math.cos(headDeg * RAD), z: sm.z - 0.2 * Math.sin(headDeg * RAD) }
  Object.assign(w[LM.leftEar], { ...ear, x: -0.07 })
  Object.assign(w[LM.rightEar], { ...ear, x: 0.07 })
  const rs = w[LM.rightShoulder]
  Object.assign(w[LM.rightElbow], { x: rs.x + 0.3, y: rs.y, z: rs.z })
  Object.assign(w[LM.rightWrist], { x: rs.x + 0.6, y: rs.y, z: rs.z })
  Object.assign(w[LM.leftElbow], { x: -0.18, y: rs.y + 0.3, z: 0 })
  Object.assign(w[LM.leftWrist], { x: -0.18, y: rs.y + 0.6, z: 0 })
  return w
}

const frame = (w: Landmark[]): PoseFrame => ({ t: 0, image: w, world: w })
const series = (w: Landmark[]): PoseSeries => ({ fps: 30, durationS: 1 / 30, width: 720, height: 1280, model: 't', smoothed: true, frames: [frame(w)] })

describe('guideReadings', () => {
  it('uses the measurement formulas: torso lean, head, knees, feet', () => {
    const upright = pose({}, 20)
    const g = guideReadings(frame(upright), armLengths(series(upright)))
    expect(g.trunk).toBeCloseTo(0, 5)
    expect(g.head).toBeCloseTo(20, 5)
    // Same value as the neck series the phrase theme reads.
    expect(g.head).toBeCloseTo(headTrunk(series(upright)).neck[0] as number, 8)
    expect(g.feet).toBeCloseTo(0, 5)
    // Straight knees: no knee value.
    expect(g.knees).toEqual({ left: null, right: null })

    const lean = pose({ trunkDeg: 12 })
    expect(guideReadings(frame(lean), { left: null, right: null }).trunk).toBeCloseTo(12, 5)

    const plie = pose({ plie: { bendDeg: 60, devDeg: 10 } })
    const k = guideReadings(frame(plie), { left: null, right: null }).knees
    expect(Math.abs(k.left!)).toBeCloseTo(10, 3)
    expect(Math.abs(k.right!)).toBeCloseTo(10, 3)
  })

  it('arm reach is in the clip’s arm lengths, from the middle of the shoulders', () => {
    const w = pose()
    const arm = armLengths(series(w))
    expect(arm.right).toBeCloseTo(0.6, 8)
    const g = guideReadings(frame(w), arm)
    // Right wrist 0.18 + 0.6 m from the middle of the shoulders, arm 0.6 m.
    expect(g.arms.right).toBeCloseTo(0.78 / 0.6, 8)
  })

  it('a frame without a pose has no guides', () => {
    expect(guideReadings(null, { left: 1, right: 1 })).toEqual({ trunk: null, head: null, knees: { left: null, right: null }, arms: { left: null, right: null }, feet: null })
  })
})

describe('guide labels', () => {
  it('say the direction in words, never a verdict', () => {
    expect(kneeText(8.2)).toBe('8° inside')
    expect(kneeText(-5)).toBe('5° outside')
    expect(kneeText(0.3)).toBe('in line')
    expect(feetText(12)).toBe('12° apart')
    expect(feetText(-4)).toBe('4° towards each other')
    expect(feetText(0.2)).toBe('parallel')
    expect(reachText(1.234)).toBe('1.23×')
  })
})
