// The stroke icons of the designs, by name. Paths are copied from the .dc.html files
// (24×24, stroke 1.75, round caps). Size comes from the design CSS where a parent sets
// it (.btn svg, .privacy svg, .sidenav svg, …); otherwise pass `size`.

import type { CSSProperties } from 'react'

const PATHS = {
  // navigation
  home: 'M3 11l9-7 9 7v9h-6v-6H9v6H3z',
  library: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  import: 'M12 3v12M7 10l5 5 5-5M4 17v3h16v-3',
  processing: 'M7 7h10v10H7zM10 3v4M14 3v4M10 17v4M14 17v4M3 10h4M3 14h4M17 10h4M17 14h4',
  review: 'M3 5h18v14H3zM10 9l5 3-5 3z',
  compare: 'M4 5h7v14H4zM13 5h7v14h-7z',
  progress: 'M4 19h16M6 15l4-5 4 3 5-7',
  notes: 'M6 3h9l4 4v14H6zM9 12h7M9 16h5',
  chat: 'M4 5h16v11H9l-5 4zM8 9h8M8 12h5',
  dataset: 'M3 5h18v14H3zM3 10h18M3 15h18M9 5v14',
  settings: 'M4 7h10M18 7h2M4 17h4M12 17h8M14 4v6M8 14v6',
  // privacy and states
  device: 'M7 3h10v18H7zM11 18h2',
  lock: 'M6 11h12v10H6zM8 11V7a4 4 0 0 1 8 0v4',
  warning: 'M12 4l9 16H3zM12 10v4M12 17v.5',
  info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 11v6M12 7.5v.5',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2',
  filter: 'M4 5h16l-6 8v6l-4-2v-4z',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4',
  // actions
  plus: 'M12 5v14M5 12h14',
  close: 'M6 6l12 12M18 6L6 18',
  check: 'M5 12l5 5 9-10',
  trash: 'M4 7h16M10 7V4h4v3M6 7l1 13h10l1-13',
  copy: 'M8 8h12v12H8zM4 16V4h12',
  refresh: 'M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7',
  download: 'M12 4v12M7 11l5 5 5-5M5 20h14',
  upload: 'M12 16V8M8 12l4-4 4 4M5 20h14',
  mail: 'M3 6h18v12H3zM3 7l9 6 9-6',
  camera: 'M4 7h4l2-2h4l2 2h4v12H4zM12 10a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  'sign-out': 'M14 4h6v16h-6M4 12h11M11 8l4 4-4 4',
  sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M19 5l-1.5 1.5M6.5 17.5L5 19',
  moon: 'M20 14a8 8 0 1 1-10-10 6.5 6.5 0 0 0 10 10z',
  // arrows
  'chevron-left': 'M15 6l-6 6 6 6',
  'chevron-right': 'M9 6l6 6-6 6',
  'chevron-down': 'M6 9l6 6 6-6',
  'arrow-right': 'M5 12h14M13 6l6 6-6 6',
  // transport
  play: 'M7 5l12 7-12 7z',
  pause: 'M8 5v14M16 5v14',
  'step-forward': 'M6 6l8 6-8 6zM18 6v12',
  'step-back': 'M18 6l-8 6 8 6zM6 6v12',
} as const

export type IconName = keyof typeof PATHS

export const ICON_NAMES = Object.keys(PATHS) as IconName[]

export interface IconProps {
  name: IconName
  /** Pixels; omit inside .btn / .privacy / .sidenav / .alert etc., where the CSS sizes it. */
  size?: number
  /** Accessible name. Without it the icon is decorative (aria-hidden). */
  label?: string
  style?: CSSProperties
  className?: string
}

export function Icon({ name, size, label, style, className }: IconProps) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      style={{ flex: 'none', ...style }}
    >
      <path d={PATHS[name]} />
    </svg>
  )
}

/** The app mark (accent tile with the figure), 28px in the designs. */
export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" fill="none" aria-hidden="true" style={{ flex: 'none' }}>
      <rect width="28" height="28" rx="8" fill="var(--accent)" />
      <path d="M14 6v14" stroke="var(--accent-ink)" strokeWidth="2" strokeLinecap="round" />
      <circle cx="14" cy="7.5" r="2.5" fill="var(--accent-ink)" />
      <path d="M9 21h10" stroke="var(--accent-ink)" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}
