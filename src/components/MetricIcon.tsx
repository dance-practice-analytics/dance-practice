import type { MetricId } from '../types'

/** Tiny diagrams of what each measurement looks at. */
export function MetricIcon({ id }: { id: MetricId }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  return (
    <svg className="metric-icon" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      {id === 'kneeToe' && (
        <g {...common}>
          <path d="M12 2.5 9 11.5l3 7.5 4.5 1.5" />
          <path d="M16.5 20.5V8" strokeDasharray="1.5 2.5" opacity="0.7" />
          <circle cx="9" cy="11.5" r="1.6" fill="currentColor" stroke="none" />
        </g>
      )}
      {id === 'shoulderEar' && (
        <g {...common}>
          <circle cx="12" cy="6.5" r="3.4" />
          <path d="M3.5 15.5h17M12 10v5.5" />
          <path d="M7.6 7.4 5.6 15.2M16.4 7.4l2 7.8" strokeDasharray="1.5 2.2" opacity="0.75" />
        </g>
      )}
      {id === 'trunkTilt' && (
        <g {...common}>
          <path d="M9 21V4" strokeDasharray="1.5 2.5" opacity="0.7" />
          <path d="M9 21 14.5 5" />
          <path d="M9 13.5a7.5 7.5 0 0 1 2.6 0.4" />
        </g>
      )}
      {id === 'heelLift' && (
        <g {...common}>
          <path d="M3 21h18" opacity="0.6" />
          <path d="M8 5.5v6.5l-2 3.5 11 5" />
          <path d="M6 18.2V15.5" strokeDasharray="1.2 1.8" />
          <path d="m4.6 14.6 1.4-1.4 1.4 1.4" />
        </g>
      )}
    </svg>
  )
}
