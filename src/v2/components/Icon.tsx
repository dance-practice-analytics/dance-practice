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
  // Mika, the AI practice assistant: a small friendly robot (antenna, head, eyes, smile).
  mika: 'M12 3v2.5M12 2.6h.01M7.5 7.5h9a2.5 2.5 0 0 1 2.5 2.5v6a2.5 2.5 0 0 1-2.5 2.5h-9A2.5 2.5 0 0 1 5 16v-6a2.5 2.5 0 0 1 2.5-2.5zM9.5 11.5v1M14.5 11.5v1M10 15.5c1.2.8 2.8.8 4 0M3 12v2.5M21 12v2.5',
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

// The brand mark: "Logo B1 · Arabesque, refined line" on a 64-unit grid. The same two
// paths are in scripts/make-icons.mjs (favicon and app icons) and in the old prototype's
// BrandMark; change all three together.
/** The skirt, filled. */
export const MARK_FILL = 'M21.8 33.2C25.6 28.6 34.8 27.4 39.2 30.2C36.6 34.8 27.6 37.4 21.8 33.2Z'
/** Head, arms and legs, stroked with round caps and joins. */
export const MARK_FIGURE =
  'M12.6 16.5a3.4 3.4 0 1 0 6.8 0a3.4 3.4 0 1 0 -6.8 0M19.6 20.6C23 24.5 26.2 28.2 29.6 31.2M21 22C15.5 21.8 10 20.3 5 17M22.4 22.6C29 22.5 34.5 19.5 38.5 14.5M29.8 32.2C30.6 40 30.9 48 31 56.4L31.3 60M30.8 31.6C39 31.2 48 28.2 59.5 21.8'
/** The floor line under the supporting foot. */
export const MARK_FLOOR = 'M24 60.6H37'
/** The whole stroked part of the mark. */
export const MARK_LINE = MARK_FIGURE + MARK_FLOOR

/**
 * Stroke (in grid units) and size of the figure inside its tile. The line gets heavier
 * and the figure fills more of the tile as the mark gets smaller, as in the logo sheet.
 */
export function markWeight(px: number): { stroke: number; scale: number } {
  if (px < 52) return { stroke: 4.6, scale: 0.92 }
  if (px < 96) return { stroke: 3.3, scale: 0.84 }
  return { stroke: 2.7, scale: 0.78 }
}

/** The app mark (lime tile with the navy figure, as on the landing page), 28px in the designs. Same in both themes. */
export function Logo({ size = 28 }: { size?: number }) {
  const { stroke, scale } = markWeight(size)
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden="true" style={{ flex: 'none' }}>
      <rect width="64" height="64" rx="16" fill="var(--lime, #C8F54A)" />
      <g transform={`translate(32 32) scale(${scale}) translate(-32 -32)`}>
        <path d={MARK_FILL} fill="var(--navy, #0B1533)" />
        <path d={MARK_LINE} stroke="var(--navy, #0B1533)" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" />
      </g>
    </svg>
  )
}
