// The entrance: after a sign-in or sign-up typed on this screen, the brand figure does a
// pirouette over the page while the account loads, then the overlay fades out.
// It never plays on a restored session (reload) and never with reduced motion.
// Decoration only: hidden from assistive tech, and it doesn't hold the app back; the
// screens load underneath it.

import { useEffect, useSyncExternalStore } from 'react'
import { MARK_FIGURE, MARK_FILL, MARK_FLOOR } from './components/Icon'

/** Longest the overlay can stay, should its animation-end event never arrive. */
const SAFETY_MS = 3000

let playing = false
const listeners = new Set<() => void>()

function set(next: boolean) {
  if (playing === next) return
  playing = next
  listeners.forEach((l) => l())
}

const subscribe = (cb: () => void) => {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

/** Call once the credentials were accepted. */
export function playEntrance(): void {
  if (typeof window === 'undefined') return
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
  set(true)
}

export function Entrance() {
  const on = useSyncExternalStore(subscribe, () => playing)

  useEffect(() => {
    if (!on) return
    const t = window.setTimeout(() => set(false), SAFETY_MS)
    return () => window.clearTimeout(t)
  }, [on])

  if (!on) return null
  const line = { fill: 'none', stroke: 'currentColor', strokeWidth: 2.7, strokeLinecap: 'round', strokeLinejoin: 'round' } as const
  return (
    <div
      className="v2-entrance"
      aria-hidden="true"
      // The figure's own animation ends first and bubbles; only the overlay's fade closes it.
      onAnimationEnd={(e) => {
        if (e.target === e.currentTarget) set(false)
      }}
    >
      <div className="v2-entrance-stage">
        {/* The floor line stays put; the dancer turns over it. */}
        <svg viewBox="0 0 64 64">
          <path d={MARK_FLOOR} {...line} />
        </svg>
        <svg viewBox="0 0 64 64" className="v2-entrance-dancer">
          <path d={MARK_FILL} fill="currentColor" />
          <path d={MARK_FIGURE} {...line} />
        </svg>
      </div>
    </div>
  )
}
