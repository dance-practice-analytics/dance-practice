// React bindings of the playback clock. `useClockValue` re-renders a component only
// when the value it selects changes, so a ribbon follows the current phase and a
// readout follows the frame without the page rendering at frame rate.

import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { createClock, type Clock, type ClockState } from './clock'

/** One clock for the lifetime of a workspace component. */
export function useWorkspaceClock(): Clock {
  const clock = useMemo(() => createClock(), [])
  useEffect(() => () => clock.pause(), [clock])
  return clock
}

/** `select` must return a primitive or a stable reference (e.g. a frame of the series). */
export function useClockValue<T>(clock: Clock, select: (s: ClockState) => T): T {
  return useSyncExternalStore(clock.subscribe, () => select(clock.get()))
}

const isTyping = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))

const isControl = (el: EventTarget | null) =>
  el instanceof HTMLElement && (/^(BUTTON|A|SUMMARY)$/.test(el.tagName) || el.getAttribute('role') === 'slider')

export interface ShortcutOptions {
  /** `[` / `]`: go to the previous / next phase start. */
  onPhase?(direction: -1 | 1): void
}

/**
 * Space = play / pause, ← → = one frame, [ ] = phase. Keys typed into a field, a select
 * or with a modifier are left alone; Space and arrows on a focused control keep their
 * own meaning (press the button, move the slider).
 */
export function useTransportKeys(clock: Clock, options: ShortcutOptions = {}): void {
  const { onPhase } = options
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return
      if (e.key === ' ' || e.code === 'Space') {
        if (isControl(e.target)) return
        e.preventDefault()
        clock.toggle()
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        if (e.target instanceof HTMLElement && e.target.closest('[role="slider"],[role="tablist"],[role="radiogroup"]')) return
        e.preventDefault()
        clock.step(e.key === 'ArrowLeft' ? -1 : 1)
      } else if ((e.key === '[' || e.key === ']') && onPhase) {
        e.preventDefault()
        onPhase(e.key === '[' ? -1 : 1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [clock, onPhase])
}

/** Dev-only render counter (`window.__dpaRenders`), used to check that playback doesn't re-render a page. */
export function countRender(name: string): void {
  if (!import.meta.env.DEV || typeof window === 'undefined') return
  const w = window as unknown as { __dpaRenders?: Record<string, number> }
  const counts = (w.__dpaRenders ??= {})
  counts[name] = (counts[name] ?? 0) + 1
}
