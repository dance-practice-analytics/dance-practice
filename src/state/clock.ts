// Single playback clock shared by the video stage, charts and timeline.
// It lives outside React state so the playhead can move at frame rate while
// only the small components that read it re-render.

import { useSyncExternalStore } from 'react'
import type { Seconds } from '../types'

export interface ClockState {
  time: Seconds
  playing: boolean
  rate: number
}

interface Range { start: Seconds; end: Seconds }

let state: ClockState = { time: 0, playing: false, rate: 1 }
let duration: Seconds = 0
let loop: Range | null = null
let raf = 0
/** While playing, the clock follows this (the video's own time) instead of counting frames, so pose and picture can't drift. */
let source: (() => Seconds | null) | null = null
let last = 0
const listeners = new Set<() => void>()

function set(next: Partial<ClockState>) {
  state = { ...state, ...next }
  listeners.forEach((l) => l())
}

function frame(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000)
  last = now
  let t = source?.() ?? state.time + dt * state.rate
  if (loop && t >= loop.end) t = loop.start
  if (!loop && t >= duration) {
    set({ time: duration, playing: false })
    return
  }
  set({ time: t })
  raf = requestAnimationFrame(frame)
}

export const clock = {
  get: () => state,
  subscribe(listener: () => void) {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },
  /** Follow a media element's time while playing; null to go back to counting frames. */
  setSource(fn: (() => Seconds | null) | null) {
    source = fn
  },
  setDuration(d: Seconds) {
    duration = d
  },
  /** Keep playback inside a range (e.g. attempt A while comparing); null to release. */
  setLoop(range: Range | null) {
    loop = range
    if (loop && (state.time < loop.start || state.time > loop.end)) set({ time: loop.start })
  },
  seek(t: Seconds) {
    const lo = loop?.start ?? 0
    const hi = loop?.end ?? duration
    set({ time: Math.min(hi, Math.max(lo, t)) })
  },
  play() {
    if (state.playing) return
    if (!loop && state.time >= duration) set({ time: 0 })
    last = performance.now()
    set({ playing: true })
    raf = requestAnimationFrame(frame)
  },
  pause() {
    cancelAnimationFrame(raf)
    set({ playing: false })
  },
  toggle() {
    if (state.playing) clock.pause()
    else clock.play()
  },
  setRate(rate: number) {
    set({ rate })
  },
}

export function useClock(): ClockState {
  return useSyncExternalStore(clock.subscribe, clock.get)
}

export function useClockTime(): Seconds {
  return useSyncExternalStore(clock.subscribe, () => state.time)
}
