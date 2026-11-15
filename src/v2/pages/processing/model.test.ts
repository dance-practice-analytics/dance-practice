import { describe, expect, it } from 'vitest'
import type { Landmark, PoseFrame } from '../../../pose/types'
import { LM } from '../../../pose/types'
import {
  batchCounts,
  batchPercent,
  entryTimeLeft,
  estimateTimeLeft,
  formatClock,
  formatTimeLeft,
  measuredFps,
  measureSpeed,
  trackingFacts,
  trackingNote,
  type QueueEntry,
} from './model'

const entry = (over: Partial<QueueEntry> = {}): QueueEntry => ({
  status: 'queued',
  fraction: 0,
  durationS: 40,
  startedAt: null,
  finishedAt: null,
  frames: null,
  ...over,
})

const T0 = 1_000_000

describe('batch counts and percent', () => {
  const entries = [
    entry({ status: 'done' }),
    entry({ status: 'processing', fraction: 0.5 }),
    entry({ status: 'failed' }),
    entry(),
  ]

  it('counts each status', () => {
    expect(batchCounts(entries)).toEqual({ total: 4, done: 1, processing: 1, queued: 1, failed: 1, cancelled: 0 })
  })

  it('counts settled clips whole and the clip in progress by its fraction', () => {
    expect(batchPercent(entries)).toBe(63) // (1 + 0.5 + 1) / 4
    expect(batchPercent([])).toBe(0)
    expect(batchPercent([entry({ status: 'done' }), entry({ status: 'cancelled' })])).toBe(100)
  })
})

describe('time left', () => {
  it('has no estimate before anything has been measured', () => {
    expect(measureSpeed([entry(), entry()], T0)).toBeNull()
    expect(estimateTimeLeft([entry(), entry()], T0)).toBeNull()
    // The model is still loading: the clip in progress has no usable fraction yet.
    expect(estimateTimeLeft([entry({ status: 'processing', fraction: 0.01, startedAt: T0 - 5000 }), entry()], T0)).toBeNull()
  })

  it('is zero when nothing is queued or running', () => {
    expect(estimateTimeLeft([entry({ status: 'done' }), entry({ status: 'failed' })], T0)).toBe(0)
  })

  it('uses the speed of finished clips', () => {
    // 40 s of clip took 60 s → 1.5 s per clip second.
    const done = entry({ status: 'done', startedAt: T0 - 60_000, finishedAt: T0 })
    expect(measureSpeed([done], T0)).toBeCloseTo(1.5)
    expect(estimateTimeLeft([done, entry({ durationS: 20 }), entry({ durationS: 10 })], T0)).toBeCloseTo(45)
  })

  it('uses the clip in progress once it is far enough along', () => {
    // A quarter of a 40 s clip in 10 s → 1 s per clip second; 30 s + 40 s left.
    const active = entry({ status: 'processing', fraction: 0.25, startedAt: T0 - 10_000 })
    expect(measureSpeed([active], T0)).toBeCloseTo(1)
    expect(estimateTimeLeft([active, entry()], T0)).toBeCloseTo(70)
    expect(entryTimeLeft(active, 1)).toBeCloseTo(30)
    expect(entryTimeLeft(active, null)).toBeNull()
    expect(entryTimeLeft(entry(), 1)).toBeNull()
  })

  it('counts a queued clip of unknown length as the mean of the known ones', () => {
    const done = entry({ status: 'done', durationS: 30, startedAt: T0 - 30_000, finishedAt: T0 })
    expect(estimateTimeLeft([done, entry({ durationS: null })], T0)).toBeCloseTo(30)
  })

  it('ignores failed and cancelled clips', () => {
    const done = entry({ status: 'done', startedAt: T0 - 40_000, finishedAt: T0 })
    const failed = entry({ status: 'failed', startedAt: T0 - 500_000, finishedAt: T0 })
    expect(estimateTimeLeft([done, failed, entry({ status: 'cancelled' }), entry()], T0)).toBeCloseTo(40)
  })

  it('measures frames per second over finished clips', () => {
    expect(measuredFps([entry({ status: 'done', frames: 1200, startedAt: T0 - 40_000, finishedAt: T0 })])).toBeCloseTo(30)
    expect(measuredFps([entry()])).toBeNull()
  })

  it('formats neutrally', () => {
    expect(formatTimeLeft(4)).toBe('Less than 10 s left')
    expect(formatTimeLeft(42)).toBe('About 40 s left')
    expect(formatTimeLeft(350)).toBe('About 6 min left')
    expect(formatClock(14.2)).toBe('0:14')
    expect(formatClock(125)).toBe('2:05')
  })
})

describe('tracking facts', () => {
  const pose = (weak: number[] = []): Landmark[] =>
    Array.from({ length: 33 }, (_, i) => ({ x: 0.5, y: 0.5, z: 0, visibility: weak.includes(i) ? 0.3 : 0.9 }))
  const frame = (image: Landmark[] | null, t = 0): PoseFrame => ({ t, image, world: image })

  it('counts tracked frames, low-confidence frames and the weakest landmark', () => {
    const facts = trackingFacts({
      frames: [frame(pose()), frame(null), frame(pose([LM.leftKnee])), frame(pose([LM.leftKnee, LM.rightHeel])), frame(pose([LM.nose]))],
    })
    // The nose is not used by any measurement, so it doesn't make a frame low-confidence.
    expect(facts).toEqual({ frames: 5, tracked: 4, lowConfidence: 2, weakest: 'left knee' })
  })

  it('reports nothing weak for a clean series and for an empty one', () => {
    expect(trackingFacts({ frames: [frame(pose())] })).toEqual({ frames: 1, tracked: 1, lowConfidence: 0, weakest: null })
    expect(trackingFacts({ frames: [frame(null)] })).toEqual({ frames: 1, tracked: 0, lowConfidence: 0, weakest: null })
  })

  it('describes low tracking neutrally, and says nothing when most frames have a pose', () => {
    expect(trackingNote(250, 0)).toMatch(/No person was found/)
    expect(trackingNote(250, 100)).toBe('A pose was found in 100 of 250 frames. Measurements that need the other frames are shown as gaps.')
    expect(trackingNote(250, 240)).toBeNull()
    expect(trackingNote(null, null)).toBeNull()
  })
})
