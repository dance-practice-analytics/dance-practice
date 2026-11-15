import { useSyncExternalStore } from 'react'

export type Theme = 'light' | 'dark'

const KEY = 'dad-theme'
const listeners = new Set<() => void>()

function initial(): Theme {
  try {
    const saved = localStorage.getItem(KEY)
    if (saved === 'light' || saved === 'dark') return saved
  } catch {
    // storage blocked: fall back to the system preference
  }
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

let theme: Theme = initial()
document.documentElement.dataset.theme = theme

export function toggleTheme() {
  theme = theme === 'dark' ? 'light' : 'dark'
  document.documentElement.dataset.theme = theme
  try {
    localStorage.setItem(KEY, theme)
  } catch {
    // not persisted; the toggle still applies to this tab
  }
  listeners.forEach((l) => l())
}

export function useTheme(): Theme {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => {
        listeners.delete(cb)
      }
    },
    () => theme,
  )
}

/** SVG chart colours. Recharts writes fills as attributes, which can't read CSS variables. */
export interface ChartColors {
  a: string
  b: string
  accent: string
  ink: string
  muted: string
  grid: string
  band: string
}

const CHART: Record<Theme, ChartColors> = {
  light: { a: '#2f6fe0', b: '#c97a12', accent: '#6d4ff2', ink: '#3a3a3f', muted: '#8a8a90', grid: '#ebebe7', band: '#f4f4f1' },
  dark: { a: '#5a8ff0', b: '#c4872a', accent: '#a28cff', ink: '#d9d8d4', muted: '#7f7f86', grid: '#2a2a2e', band: '#1e1e21' },
}

export function useChartColors(): ChartColors {
  return CHART[useTheme()]
}
