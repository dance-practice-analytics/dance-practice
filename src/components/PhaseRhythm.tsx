// Phase rhythm: how long each attempt spends in plié, rise, hold and lower, on
// one shared time scale. Durations only; no attempt is ranked or graded.

import type { CSSProperties } from 'react'
import type { Attempt, Seconds } from '../types'
import { PHASES } from '../lib/phases'

interface Props {
  attempts: Attempt[]
  /** Playhead time; the attempt that contains it is highlighted. */
  time?: Seconds | null
  /** Makes each phase a button that jumps to its start. */
  onSeek?: (t: Seconds) => void
  roles?: Record<string, 'a' | 'b'>
}

export function PhaseRhythm({ attempts, time = null, onSeek, roles }: Props) {
  const longest = Math.max(0.001, ...attempts.map((a) => a.end - a.start))
  return (
    <div className="rhythm">
      <div className="rhythm-rows">
        {attempts.map((a, i) => {
          const span = a.end - a.start
          const inside = time !== null && time >= a.start && time <= a.end
          const role = roles?.[a.id]
          return (
            <div
              key={a.id}
              className={`rhythm-row ${inside ? 'is-current' : ''}`}
              style={{ '--i': i } as CSSProperties}
              role="group"
              aria-label={`Attempt ${a.index}: ${a.phases.map((p) => `${p.label} ${(p.end - p.start).toFixed(1)} s`).join(', ')}`}
            >
              <span className="rhythm-name">
                {role && <i className={`rhythm-role role-${role}`}>{role.toUpperCase()}</i>}
                Attempt {a.index}
              </span>
              <div className="rhythm-track">
                <div className="rhythm-bar" style={{ width: `${(span / longest) * 100}%` }}>
                  {a.phases.map((p) => {
                    const d = p.end - p.start
                    const w = (d / span) * 100
                    const body = w > 16 ? <em>{d.toFixed(1)}</em> : null
                    const title = `${p.label} · ${d.toFixed(1)} s`
                    return onSeek ? (
                      <button key={p.id} className={`rhythm-seg rs-${p.id}`} style={{ width: `${w}%` }} title={title} aria-label={`Play attempt ${a.index} from ${p.label.toLowerCase()}`} onClick={() => onSeek(p.start)}>{body}</button>
                    ) : (
                      <span key={p.id} className={`rhythm-seg rs-${p.id}`} style={{ width: `${w}%` }} title={title}>{body}</span>
                    )
                  })}
                  {inside && <span className="rhythm-head" style={{ left: `${((time! - a.start) / span) * 100}%` }} />}
                </div>
              </div>
              <span className="rhythm-total">{span.toFixed(1)} s</span>
            </div>
          )
        })}
      </div>
      <div className="legend rhythm-legend">
        {PHASES.map((p) => (
          <span key={p.id}><i className={`swatch rs-${p.id}`} /> {p.label}</span>
        ))}
        <span className="rhythm-note">Bar length is the attempt’s duration; numbers are seconds.</span>
      </div>
    </div>
  )
}
