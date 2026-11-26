// Small drawings that show what each measurement looks at, for the "What is this?"
// panel of a metric card. A plain stick figure in the text colour; the part being
// measured in the measure colour (navy on light, lime on dark), with a dashed reference line. Illustrations only,
// never pose data, and hidden from assistive tech (the sentence beside it says it).

import type { MetricKey } from '../format'

const LINE = { fill: 'none', stroke: 'currentColor', strokeWidth: 2.4, strokeLinecap: 'round', strokeLinejoin: 'round' } as const
const MEASURED = { ...LINE, stroke: 'var(--measure)', strokeWidth: 2.8 } as const
const GUIDE = { fill: 'none', stroke: 'var(--measure)', strokeWidth: 1.4, strokeDasharray: '3 3', strokeLinecap: 'round' } as const

function Drawing({ metric }: { metric: MetricKey }) {
  switch (metric) {
    case 'trunk_inclination_deg':
      // Torso tipped from the hips; the dashed line is straight up, the arc the lean.
      return (
        <>
          <path d="M32 10V40" {...GUIDE} />
          <circle cx="40" cy="12" r="4.5" {...LINE} />
          <path d="M32 40L38 18" {...MEASURED} />
          <path d="M32 26A14 14 0 0 1 36 26.5" {...GUIDE} strokeDasharray="none" />
          <path d="M36 24L46 30M36 24L26 30M32 40L28 60M32 40L36 60" {...LINE} />
        </>
      )
    case 'pelvis_ankle_offset_norm':
      // On relevé: the dashed line drops from the hips; the arrow is the distance to the foot.
      return (
        <>
          <circle cx="36" cy="9" r="4.5" {...LINE} />
          <path d="M36 14V32M36 20L26 28M36 20L46 28M36 32L30 46L29 58M36 32L40 46L44 56" {...LINE} />
          <circle cx="36" cy="32" r="2.6" fill="var(--measure)" />
          <path d="M36 34V60" {...GUIDE} />
          <path d="M29 60H36" {...MEASURED} />
          <path d="M27 60H23" {...LINE} strokeWidth={1.6} />
        </>
      )
    case 'balance_duration_s':
      // A foot up on relevé and a stopwatch.
      return (
        <>
          <path d="M12 58H52" {...LINE} strokeWidth={1.6} />
          <path d="M20 22V44L24 56H30" {...LINE} />
          <circle cx="44" cy="26" r="11" {...MEASURED} />
          <path d="M44 26V19M44 26L49 29M41 12H47" {...MEASURED} strokeWidth={2.2} />
        </>
      )
    case 'knee_tracking_dev_deg':
      // A leg in plié from the front: the dashed line is where the toes point, the accent where the knee points.
      return (
        <>
          <path d="M30 8L22 32L32 56" {...LINE} />
          <path d="M32 56L40 58" {...LINE} />
          <path d="M32 56V14" {...GUIDE} />
          <path d="M32 56L20 26" {...MEASURED} strokeWidth={2} strokeDasharray="none" />
          <circle cx="22" cy="32" r="3" fill="var(--measure)" />
          <path d="M28 40A16 16 0 0 1 32 39.5" {...GUIDE} strokeDasharray="none" />
        </>
      )
    case 'turn_count':
      // A figure inside a circular arrow.
      return (
        <>
          <circle cx="32" cy="14" r="4" {...LINE} />
          <path d="M32 18V38M32 24L25 30M32 24L39 30M32 38L30 54M32 38L34 54" {...LINE} />
          <path d="M14 36A20 12 0 1 0 22 26" {...MEASURED} />
          <path d="M22 26L22 20M22 26L28 27" {...MEASURED} />
        </>
      )
    case 'feet_angle_deg':
      // Both feet from above, heels at the bottom: the dashed lines are parallel, the accent the
      // direction each foot points (here slightly apart at the toes), the arc the angle between them.
      return (
        <>
          <path d="M22 54V12M42 54V12" {...GUIDE} />
          <ellipse cx="20" cy="34" rx="6" ry="17" transform="rotate(-9 22 52)" {...LINE} />
          <ellipse cx="44" cy="34" rx="6" ry="17" transform="rotate(9 42 52)" {...LINE} />
          <path d="M22 52L17 20M42 52L47 20" {...MEASURED} strokeWidth={2} />
          <path d="M18.5 30A22 22 0 0 0 22 29.4M42 29.4A22 22 0 0 0 45.5 30" {...GUIDE} strokeDasharray="none" />
        </>
      )
  }
}

export function MetricFigure({ metric, size = 72 }: { metric: MetricKey; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" style={{ flex: 'none', color: 'var(--text-2)' }}>
      <Drawing metric={metric} />
    </svg>
  )
}
