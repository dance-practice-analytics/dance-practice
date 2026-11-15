// Light / dark theme of the v2 app. The preference is 'system' until the user picks
// one; the resolved theme goes on the `.app` root as the class `dark` (App.tsx) and on
// <html> as `v2-dark` so the page behind the root matches.

import { useSyncExternalStore } from 'react'

export type Theme = 'light' | 'dark'
export type ThemePref = Theme | 'system'

const KEY = 'dpa-theme'
const listeners = new Set<() => void>()
const media = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null

function load(): ThemePref {
  try {
    const saved = localStorage.getItem(KEY)
    if (saved === 'light' || saved === 'dark') return saved
  } catch {
    // Storage blocked: follow the system.
  }
  return 'system'
}

let pref: ThemePref = load()

const resolve = (): Theme => (pref === 'system' ? (media?.matches ? 'dark' : 'light') : pref)
let theme: Theme = resolve()

function apply() {
  theme = resolve()
  document.documentElement.classList.toggle('v2-dark', theme === 'dark')
  listeners.forEach((l) => l())
}

apply()
media?.addEventListener('change', () => {
  if (pref === 'system') apply()
})

export function setThemePref(next: ThemePref): void {
  pref = next
  try {
    if (next === 'system') localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, next)
  } catch {
    // Not persisted; still applies to this tab.
  }
  apply()
}

export function toggleTheme(): void {
  setThemePref(theme === 'dark' ? 'light' : 'dark')
}

const subscribe = (cb: () => void) => {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

/** The theme in effect. */
export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, () => theme)
}

/** What the user chose: 'light', 'dark' or 'system' (Settings › Appearance). */
export function useThemePref(): ThemePref {
  return useSyncExternalStore(subscribe, () => pref)
}
