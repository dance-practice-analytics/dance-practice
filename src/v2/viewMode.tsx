// "Simple" or "Detail" view of the analysis screens. Simple (the default) is for the
// dancer: video, measurements in plain words and the comparison. Detail adds the
// frame-by-frame traces, tracking bands, phases of each value and the raw arithmetic,
// for the researcher or a curious dancer. Remembered on this device only.

import { useSyncExternalStore } from 'react'

export type ViewMode = 'simple' | 'detail'

const KEY = 'dpa-view-mode'
const listeners = new Set<() => void>()

function load(): ViewMode {
  try {
    return localStorage.getItem(KEY) === 'detail' ? 'detail' : 'simple'
  } catch {
    return 'simple'
  }
}

let mode: ViewMode = load()

export function setViewMode(next: ViewMode): void {
  if (next === mode) return
  mode = next
  try {
    localStorage.setItem(KEY, next)
  } catch {
    // Storage blocked: the choice lasts until reload.
  }
  listeners.forEach((l) => l())
}

const subscribe = (cb: () => void) => {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

export function useViewMode(): ViewMode {
  return useSyncExternalStore(subscribe, () => mode, () => 'simple')
}

/** The Simple / Detail switch, a `.seg` of two buttons. */
export function ViewModeSwitch() {
  const current = useViewMode()
  return (
    <div className="seg" role="group" aria-label="How much to show">
      {(['simple', 'detail'] as const).map((m) => (
        <button key={m} type="button" className={current === m ? 'on' : undefined} aria-pressed={current === m} onClick={() => setViewMode(m)}>
          {m === 'simple' ? 'Simple' : 'Detail'}
        </button>
      ))}
    </div>
  )
}
