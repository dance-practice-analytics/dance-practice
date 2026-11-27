import { describe, expect, it } from 'vitest'
import { LM, type Landmark, type PoseSeries } from '../../../pose/types'
import { blendText, bodyAnchor, matchTransform, SCALE_MAX, transformCss } from './overlay'

/** A frame with only the four trunk landmarks placed: hips at (x, y), shoulders `torso` higher (normalized height). */
function frame(t: number, x: number, y: number, torso: number, visibility = 0.9) {
  const lm: Landmark[] = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, visibility: 0 }))
  const put = (i: number, px: number, py: number) => (lm[i] = { x: px, y: py, z: 0, visibility })
  put(LM.leftHip, x - 0.02, y)
  put(LM.rightHip, x + 0.02, y)
  put(LM.leftShoulder, x - 0.03, y - torso)
  put(LM.rightShoulder, x + 0.03, y - torso)
  return { t, image: lm, world: null }
}

function series(frames: ReturnType<typeof frame>[] | PoseSeries['frames'], width = 1280, height = 720): PoseSeries {
  return { fps: 30, durationS: frames.length / 30, width, height, model: 'test', smoothed: true, frames }
}

describe('bodyAnchor', () => {
  it('medians of the hip midpoint and torso length over well-tracked frames', () => {
    const s = series([frame(0, 0.4, 0.6, 0.2), frame(1 / 30, 0.42, 0.62, 0.2), frame(2 / 30, 0.9, 0.9, 0.2, 0.3), { t: 0.1, image: null, world: null }])
    const a = bodyAnchor(s)!
    expect(a.frames).toBe(2)
    expect(a.x).toBeCloseTo(0.41)
    expect(a.y).toBeCloseTo(0.61)
    // 0.2 of the height, in widths: 0.2 * 720 / 1280
    expect(a.torso).toBeCloseTo(0.1125)
  })

  it('is null with no well-tracked frame', () => {
    expect(bodyAnchor(null)).toBeNull()
    expect(bodyAnchor(series([frame(0, 0.5, 0.5, 0.2, 0.2)]))).toBeNull()
  })
})

describe('matchTransform', () => {
  it('puts A’s hips on B’s and gives A’s torso B’s length', () => {
    const a = series([frame(0, 0.3, 0.6, 0.2)])
    const b = series([frame(0, 0.6, 0.5, 0.3)])
    const m = matchTransform(a, b)
    if (typeof m === 'string') throw new Error(m)
    expect(m.scale).toBeCloseTo(1.5)
    // A's hip point after the move lands on B's.
    expect(m.scale * 0.3 + m.tx).toBeCloseTo(0.6)
    expect(m.scale * 0.6 + m.ty).toBeCloseTo(0.5)
  })

  it('is the identity for the same body in the same place', () => {
    const a = series([frame(0, 0.5, 0.6, 0.25)])
    const m = matchTransform(a, a)
    expect(m).toEqual({ tx: 0, ty: 0, scale: 1 })
    expect(transformCss(m as Exclude<typeof m, string>)).toBe('translate(0%, 0%) scale(1)')
  })

  it('caps the scale and says why it can’t line up', () => {
    const m = matchTransform(series([frame(0, 0.5, 0.6, 0.05)]), series([frame(0, 0.5, 0.6, 0.4)]))
    expect(typeof m !== 'string' && m.scale).toBe(SCALE_MAX)
    expect(matchTransform(series([]), series([frame(0, 0.5, 0.6, 0.2)]))).toBe('no_pose_a')
    expect(matchTransform(series([frame(0, 0.5, 0.6, 0.2)]), null)).toBe('no_pose_b')
    expect(matchTransform(series([frame(0, 0.5, 0.6, 0.2)]), series([frame(0, 0.5, 0.6, 0.2)], 720, 1280))).toBe('different_shape')
  })
})

describe('blendText', () => {
  it('names what is on screen', () => {
    expect(blendText(0)).toBe('B’s video only')
    expect(blendText(0.5)).toBe('A’s video at 50% over B’s')
    expect(blendText(1)).toBe('A’s video only')
  })
})
