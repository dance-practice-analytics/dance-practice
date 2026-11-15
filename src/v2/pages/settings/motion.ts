// "Reduce motion" (Settings › Appearance): stops the loading shimmer and spinners for
// people who want that without changing the system setting. The choice is a class on
// <html>, read by settings.css; it is applied when this module loads, so it holds on
// every screen after a reload.

import { useSyncExternalStore } from 'react'

const KEY = 'dpa-reduce-motion'
const CLASS = 'v2-set-calm'
const listeners = new Set<() => void>()

function load(): boolean {
  try {
    return localStorage.getItem(KEY) === 'on'
  } catch {
    return false
  }
}

let on = load()

function apply() {
  if (typeof document !== 'undefined') document.documentElement.classList.toggle(CLASS, on)
  listeners.forEach((l) => l())
}

apply()

export function setReduceMotion(next: boolean): void {
  on = next
  try {
    if (next) localStorage.setItem(KEY, 'on')
    else localStorage.removeItem(KEY)
  } catch {
    // Not persisted; still applies to this tab.
  }
  apply()
}

const subscribe = (cb: () => void) => {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

export function useReduceMotion(): boolean {
  return useSyncExternalStore(subscribe, () => on)
}
