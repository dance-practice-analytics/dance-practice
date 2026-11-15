// One playback clock per workspace (Review, Compare). It lives outside React state so
// the playhead can move at frame rate while only the small parts that read it re-render.
//
// Two ways of keeping time:
// - no video on this device: an animation-frame timer over the PoseSeries duration;
// - a local video is playing: the stage that leads reports the time of every frame the
//   `<video>` presents (`report`), and the timer stands still (`setExternal(true)`), so
//   the skeleton is always drawn for the picture that is on screen.
// Paused times sit on the frame grid of the PoseSeries (`fps`), so a step is one frame.

export interface ClockState {
  /** Seconds from the start of the clip (of attempt A in Compare). */
  time: number
  playing: boolean
  /** Playback speed: 0.25, 0.5 or 1. */
  rate: number
  duration: number
  /** Frame grid of paused times; 0 = no grid. */
  fps: number
}

export interface TimeRange {
  start: number
  end: number
}

/** Animation-frame source; injected in tests. */
export interface Scheduler {
  now(): number
  request(cb: (now: number) => void): number
  cancel(id: number): void
}

export interface Clock {
  get(): ClockState
  subscribe(listener: () => void): () => void
  /** New clip: sets duration and frame grid, stops and rewinds. */
  load(duration: number, fps: number): void
  /** Clamped to the clip and snapped to the frame grid. Does not change play / pause. */
  seek(t: number): void
  /** Pauses and moves by whole frames. */
  step(frames: number): void
  play(): void
  pause(): void
  toggle(): void
  setRate(rate: number): void
  /** Repeat a span while playing (the current phase); null to release. */
  setLoop(range: TimeRange | null): void
  /** True while a playing video is the time source: the timer no longer advances. */
  setExternal(on: boolean): void
  /** Time of the frame the leading video just presented. Ignored unless playing with an external source. */
  report(t: number): void
  /** The leading video reached its end. */
  finish(): void
  dispose(): void
}

export const RATES = [0.25, 0.5, 1] as const

const browserScheduler: Scheduler = {
  now: () => performance.now(),
  request: (cb) => requestAnimationFrame(cb),
  cancel: (id) => cancelAnimationFrame(id),
}

/** Index of the frame shown at `t` (same rule as `frameAt` in format.ts). */
export function frameIndex(t: number, fps: number): number {
  return Math.max(0, Math.floor(t * fps + 1e-6))
}

/** Start time of the frame that contains `t`; `t` itself when there is no grid. */
export function snapToFrame(t: number, fps: number): number {
  return fps > 0 ? frameIndex(t, fps) / fps : t
}

/** Index of the last frame of a clip of `duration` seconds. */
export function lastFrameIndex(duration: number, fps: number): number {
  return Math.max(0, Math.ceil(duration * fps - 1e-6) - 1)
}

export function createClock(scheduler: Scheduler = browserScheduler): Clock {
  let state: ClockState = { time: 0, playing: false, rate: 1, duration: 0, fps: 0 }
  let loop: TimeRange | null = null
  let external = false
  let raf = 0
  let last = 0
  const listeners = new Set<() => void>()

  const emit = (patch: Partial<ClockState>) => {
    let changed = false
    for (const k in patch) {
      const key = k as keyof ClockState
      if (patch[key] !== state[key]) changed = true
    }
    if (!changed) return
    state = { ...state, ...patch }
    listeners.forEach((l) => l())
  }

  const clamp = (t: number) => Math.min(state.duration, Math.max(0, Number.isFinite(t) ? t : 0))
  /** Latest time a seek can land on: the start of the last frame. */
  const lastStart = () => (state.fps > 0 ? lastFrameIndex(state.duration, state.fps) / state.fps : state.duration)

  const stopTimer = () => {
    if (raf) scheduler.cancel(raf)
    raf = 0
  }
  const startTimer = () => {
    stopTimer()
    if (!state.playing || external) return
    last = scheduler.now()
    raf = scheduler.request(tick)
  }

  /** Moves the playhead forward during playback: wraps at the loop end, stops at the clip end. */
  const advance = (t: number) => {
    if (loop && state.time < loop.end && t >= loop.end) return emit({ time: snapToFrame(loop.start, state.fps) })
    if (t >= state.duration) return emit({ time: state.duration, playing: false })
    emit({ time: Math.max(0, t) })
  }

  function tick(now: number) {
    raf = 0
    if (!state.playing || external) return
    // A long pause between frames (hidden tab) is not played back as a jump.
    const dt = Math.min(0.1, Math.max(0, (now - last) / 1000))
    last = now
    advance(state.time + dt * state.rate)
    if (state.playing) raf = scheduler.request(tick)
  }

  const clock: Clock = {
    get: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    load(duration, fps) {
      stopTimer()
      loop = null
      emit({
        time: 0,
        playing: false,
        duration: Number.isFinite(duration) && duration > 0 ? duration : 0,
        fps: Number.isFinite(fps) && fps > 0 ? fps : 0,
      })
    },
    seek(t) {
      emit({ time: Math.min(snapToFrame(clamp(t), state.fps), lastStart()) })
    },
    step(frames) {
      clock.pause()
      if (!(state.fps > 0)) return
      const i = Math.min(lastFrameIndex(state.duration, state.fps), Math.max(0, frameIndex(state.time, state.fps) + frames))
      emit({ time: i / state.fps })
    },
    play() {
      if (state.playing || !(state.duration > 0)) return
      // At the end, play starts over (from the loop start when a phase is looping).
      const atEnd = state.time >= lastStart() - 1e-6
      emit({ playing: true, time: atEnd ? snapToFrame(clamp(loop?.start ?? 0), state.fps) : state.time })
      startTimer()
    },
    pause() {
      stopTimer()
      if (!state.playing) return
      // Back on the frame grid, so the next step moves exactly one frame.
      emit({ playing: false, time: Math.min(snapToFrame(state.time, state.fps), lastStart()) })
    },
    toggle() {
      if (state.playing) clock.pause()
      else clock.play()
    },
    setRate(rate) {
      emit({ rate })
    },
    setLoop(range) {
      loop = range && range.end > range.start ? range : null
    },
    setExternal(on) {
      if (external === on) return
      external = on
      startTimer()
    },
    report(t) {
      if (!state.playing || !external || !Number.isFinite(t)) return
      advance(t)
    },
    finish() {
      stopTimer()
      if (state.playing) emit({ playing: false, time: state.duration })
    },
    dispose() {
      stopTimer()
      listeners.clear()
    },
  }
  return clock
}
