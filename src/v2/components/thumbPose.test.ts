import { describe, expect, it } from 'vitest'
import type { PhaseSpan } from '../../data/schema'
import type { PoseFrame, PoseSeries } from '../../pose/types'
import { pickThumbFrame, thumbPose } from './thumbPose'

const FPS = 10
const lm = (visibility: number) => Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility }))

/** `vis[i]` = mean visibility of frame i, or null for a gap. */
const frames = (vis: (number | null)[]): PoseFrame[] =>
  vis.map((v, i) => ({ t: i / FPS, image: v === null ? null : lm(v), world: v === null ? null : lm(v) }))

describe('pickThumbFrame', () => {
  it('takes the tracked frame nearest the middle of the hold', () => {
    const f = frames(Array.from({ length: 30 }, () => 0.9))
    const phases: PhaseSpan[] = [
      { phase: 'rise', start: 0, end: 1 },
      { phase: 'hold', start: 1, end: 2 },
    ]
    expect(pickThumbFrame(f, phases)).toBe(15)
  })

  it('skips a gap at the middle of the hold rather than drawing it', () => {
    const vis: (number | null)[] = Array.from({ length: 30 }, () => 0.9)
    vis[15] = null
    const i = pickThumbFrame(frames(vis), [{ phase: 'hold', start: 1, end: 2 }])
    expect([14, 16]).toContain(i)
  })

  it('falls back to turn, then to the best-seen frame', () => {
    const f = frames([0.2, 0.4, 0.95, 0.5, 0.3, 0.6])
    expect(pickThumbFrame(f, [{ phase: 'turn', start: 0.3, end: 0.5 }])).toBe(4)
    expect(pickThumbFrame(f, [])).toBe(2)
    expect(pickThumbFrame(f, null)).toBe(2)
    // A hold with no tracked frame inside: best-seen frame of the clip.
    expect(pickThumbFrame(frames([0.3, null, null, 0.8]), [{ phase: 'hold', start: 0.1, end: 0.2 }])).toBe(3)
  })

  it('returns -1 when nothing was tracked', () => {
    expect(pickThumbFrame(frames([null, null]), [{ phase: 'hold', start: 0, end: 1 }])).toBe(-1)
    expect(pickThumbFrame([], null)).toBe(-1)
  })
})

describe('thumbPose', () => {
  const series = (vis: (number | null)[]): PoseSeries => ({
    fps: FPS,
    durationS: vis.length / FPS,
    width: 640,
    height: 360,
    model: 'pose_landmarker_full',
    smoothed: true,
    frames: frames(vis),
  })

  it('keeps one frame of 33 image points and the source size', () => {
    const pose = thumbPose(series([0.5, 0.9]))
    expect(pose?.points).toHaveLength(33)
    expect(pose?.points[0].visibility).toBe(0.9)
    expect(pose).toMatchObject({ width: 640, height: 360 })
  })

  it('has no pose when nothing was tracked', () => {
    expect(thumbPose(series([null, null]))).toBeNull()
  })
})
