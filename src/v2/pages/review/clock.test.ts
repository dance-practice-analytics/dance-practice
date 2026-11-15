import { describe, expect, it } from 'vitest'
import { createClock, frameIndex, lastFrameIndex, snapToFrame, type Scheduler } from './clock'

/** A scheduler the test advances by hand. */
function fakeScheduler() {
  let now = 0
  let next = 1
  const queue = new Map<number, (now: number) => void>()
  const scheduler: Scheduler = {
    now: () => now,
    request(cb) {
      queue.set(next, cb)
      return next++
    },
    cancel(id) {
      queue.delete(id)
    },
  }
  /** Runs the pending animation frames `ms` later. */
  const tick = (ms: number) => {
    now += ms
    const due = [...queue.entries()]
    queue.clear()
    for (const [, cb] of due) cb(now)
  }
  return { scheduler, tick, pending: () => queue.size }
}

describe('frame grid', () => {
  it('maps a time to the frame that contains it', () => {
    expect(frameIndex(0, 30)).toBe(0)
    expect(frameIndex(1 / 30, 30)).toBe(1)
    expect(frameIndex(0.0499, 30)).toBe(1)
    // 3 / 30 is 0.1 in floating point, a hair under frame 3 without the epsilon.
    expect(frameIndex(3 / 30, 30)).toBe(3)
    expect(frameIndex(-1, 30)).toBe(0)
  })

  it('snaps down to the start of the frame and knows the last frame', () => {
    expect(snapToFrame(0.049, 30)).toBeCloseTo(1 / 30, 9)
    expect(snapToFrame(1.234, 0)).toBe(1.234)
    expect(lastFrameIndex(39, 30)).toBe(1169)
    expect(lastFrameIndex(0.01, 30)).toBe(0)
  })
})

describe('clock without a video', () => {
  it('advances by elapsed time times the rate', () => {
    const { scheduler, tick } = fakeScheduler()
    const clock = createClock(scheduler)
    clock.load(10, 30)
    clock.play()
    tick(50)
    tick(50)
    expect(clock.get().time).toBeCloseTo(0.1, 6)
    clock.setRate(0.5)
    tick(100)
    expect(clock.get().time).toBeCloseTo(0.15, 6)
    expect(clock.get().playing).toBe(true)
  })

  it('does not play a long stall back as a jump', () => {
    const { scheduler, tick } = fakeScheduler()
    const clock = createClock(scheduler)
    clock.load(10, 30)
    clock.play()
    tick(5000)
    expect(clock.get().time).toBeCloseTo(0.1, 6)
  })

  it('stops at the end and starts over on the next play', () => {
    const { scheduler, tick, pending } = fakeScheduler()
    const clock = createClock(scheduler)
    clock.load(0.2, 30)
    clock.play()
    for (let i = 0; i < 5; i++) tick(100)
    expect(clock.get()).toMatchObject({ time: 0.2, playing: false })
    expect(pending()).toBe(0)
    clock.play()
    expect(clock.get()).toMatchObject({ time: 0, playing: true })
  })

  it('pauses on the frame grid and steps one frame at a time, inside the clip', () => {
    const { scheduler, tick } = fakeScheduler()
    const clock = createClock(scheduler)
    clock.load(1, 30)
    clock.play()
    tick(50)
    clock.pause()
    expect(clock.get().time).toBeCloseTo(1 / 30, 9)
    clock.step(1)
    expect(frameIndex(clock.get().time, 30)).toBe(2)
    clock.step(-5)
    expect(clock.get().time).toBe(0)
    clock.step(1000)
    expect(frameIndex(clock.get().time, 30)).toBe(29)
    expect(clock.get().playing).toBe(false)
  })

  it('seeks inside the clip, snapped to a frame, without changing play state', () => {
    const { scheduler } = fakeScheduler()
    const clock = createClock(scheduler)
    clock.load(2, 30)
    clock.seek(1.01)
    expect(clock.get().time).toBeCloseTo(30 / 30, 9)
    clock.seek(-3)
    expect(clock.get().time).toBe(0)
    clock.seek(99)
    expect(frameIndex(clock.get().time, 30)).toBe(59)
    expect(clock.get().playing).toBe(false)
    clock.seek(Number.NaN)
    expect(clock.get().time).toBe(0)
  })

  it('repeats a looped span while playing', () => {
    const { scheduler, tick } = fakeScheduler()
    const clock = createClock(scheduler)
    clock.load(10, 30)
    clock.seek(1.9)
    clock.setLoop({ start: 1, end: 2 })
    clock.play()
    tick(60)
    expect(clock.get().time).toBeGreaterThan(1.9)
    tick(60)
    expect(clock.get().time).toBeCloseTo(1, 9)
    expect(clock.get().playing).toBe(true)
    // A seek past the loop is not pulled back.
    clock.seek(5)
    tick(30)
    expect(clock.get().time).toBeGreaterThan(5)
  })

  it('notifies only when something changed', () => {
    const { scheduler } = fakeScheduler()
    const clock = createClock(scheduler)
    clock.load(2, 30)
    let calls = 0
    clock.subscribe(() => calls++)
    clock.seek(1)
    clock.seek(1)
    clock.setRate(1)
    clock.pause()
    expect(calls).toBe(1)
  })
})

describe('clock led by a video', () => {
  it('stands still while the video is the source and takes the times it reports', () => {
    const { scheduler, tick, pending } = fakeScheduler()
    const clock = createClock(scheduler)
    clock.load(10, 30)
    clock.setExternal(true)
    clock.play()
    expect(pending()).toBe(0)
    tick(500)
    expect(clock.get().time).toBe(0)
    clock.report(4 / 30)
    expect(clock.get().time).toBeCloseTo(4 / 30, 9)
    clock.report(5 / 30)
    expect(frameIndex(clock.get().time, 30)).toBe(5)
  })

  it('ignores reports while paused, so scrubbing is not overridden by an old frame', () => {
    const { scheduler } = fakeScheduler()
    const clock = createClock(scheduler)
    clock.load(10, 30)
    clock.setExternal(true)
    clock.seek(2)
    clock.report(7)
    expect(clock.get().time).toBeCloseTo(2, 9)
  })

  it('finishes when the video ends and falls back to the timer when the video goes away', () => {
    const { scheduler, tick } = fakeScheduler()
    const clock = createClock(scheduler)
    clock.load(10, 30)
    clock.setExternal(true)
    clock.play()
    clock.report(9.9)
    clock.finish()
    expect(clock.get()).toMatchObject({ time: 10, playing: false })

    clock.play()
    expect(clock.get().time).toBe(0)
    clock.setExternal(false)
    tick(100)
    expect(clock.get().time).toBeCloseTo(0.1, 6)
  })

  it('wraps a looped phase on a reported time', () => {
    const { scheduler } = fakeScheduler()
    const clock = createClock(scheduler)
    clock.load(10, 30)
    clock.setExternal(true)
    clock.seek(1.5)
    clock.setLoop({ start: 1, end: 2 })
    clock.play()
    clock.report(1.97)
    clock.report(2.0)
    expect(clock.get().time).toBeCloseTo(1, 9)
  })
})
