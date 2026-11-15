import { useLayoutEffect, useState, useSyncExternalStore, type RefObject } from 'react'
import type { Attempt, Phase } from '../types'
import { attemptNear, phaseAt } from './attempts'
import { clock } from '../state/clock'

/** Attempt under (or nearest before) the playhead. Re-renders only when it changes. */
export function useAttemptAtPlayhead(attempts: Attempt[]): Attempt {
  const id = useSyncExternalStore(clock.subscribe, () => attemptNear(attempts, clock.get().time).id)
  return attempts.find((a) => a.id === id) ?? attempts[0]
}

/** Phase of the given attempt under the playhead. Re-renders only when it changes. */
export function usePhaseAtPlayhead(attempt: Attempt, timeFor: (t: number) => number = (t) => t): Phase | undefined {
  const id = useSyncExternalStore(clock.subscribe, () => phaseAt(attempt, timeFor(clock.get().time))?.id ?? '')
  return attempt.phases.find((p) => p.id === id)
}

export function useElementWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)))
    ro.observe(el)
    setWidth(Math.floor(el.getBoundingClientRect().width))
    return () => ro.disconnect()
  }, [ref])
  return width
}
