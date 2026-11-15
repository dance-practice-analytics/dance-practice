// Whole-clip timeline: attempts and their phases (drag any edge to adjust),
// moment markers and tracking quality, with a shared playhead.

import { useMemo, useRef, type PointerEvent } from 'react'
import type { Attempt } from '../types'
import { useStudio } from '../state/studio'
import { clock, useClockTime } from '../state/clock'
import { boundaries } from '../lib/attempts'
import { qualitySpans } from '../lib/series'
import { formatTime } from '../lib/format'

function Playhead({ duration }: { duration: number }) {
  const t = useClockTime()
  return (
    <div className="tl-playhead" style={{ left: `${(t / duration) * 100}%` }}>
      <span className="tl-playhead-time">{formatTime(t)}</span>
    </div>
  )
}

export function Timeline() {
  const { results, state, dispatch } = useStudio()
  const { duration, fps } = results.session
  const laneRef = useRef<HTMLDivElement>(null)
  const scrubbing = useRef(false)
  const pct = (t: number) => `${(t / duration) * 100}%`
  const timeAt = (clientX: number) => {
    const r = laneRef.current!.getBoundingClientRect()
    return Math.min(duration, Math.max(0, ((clientX - r.left) / r.width) * duration))
  }

  const spans = useMemo(() => qualitySpans(results.series.kneeToe, 0, duration, fps), [results, duration, fps])
  const ticks = Array.from({ length: Math.floor(duration / 5) + 1 }, (_, i) => i * 5)

  const role = (a: Attempt) => (a.id === state.compare.a ? 'a' : a.id === state.compare.b ? 'b' : null)

  const startDrag = (e: PointerEvent<HTMLSpanElement>, attempt: Attempt, index: number) => {
    e.stopPropagation()
    const el = e.currentTarget
    el.setPointerCapture(e.pointerId)
    const move = (ev: globalThis.PointerEvent) => dispatch({ type: 'setBoundary', attemptId: attempt.id, index, t: timeAt(ev.clientX) })
    const up = () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      dispatch({ type: 'commitBoundaries' })
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
  }

  return (
    <div className="panel timeline">
      <div className="panel-head">
        <div>
          <div className="panel-title">Timeline</div>
          <div className="panel-sub">Drag any edge to adjust an attempt or phase. Measurements update from the confirmed boundaries.</div>
        </div>
        <span className="pill">Boundary revision {state.revision}</span>
      </div>
      <div className="tl-body">
        <div className="tl-labels">
          <span />
          <span>Attempts</span>
          <span>Moments</span>
          <span>Tracking</span>
        </div>
        <div
          className="tl-lanes"
          ref={laneRef}
          onPointerDown={(e) => {
            scrubbing.current = true
            clock.seek(timeAt(e.clientX))
            e.currentTarget.setPointerCapture(e.pointerId)
          }}
          onPointerMove={(e) => scrubbing.current && clock.seek(timeAt(e.clientX))}
          onPointerUp={() => (scrubbing.current = false)}
        >
          <div className="tl-ticks">
            {ticks.map((t) => (
              <span key={t} style={{ left: pct(t) }}>{formatTime(t).replace(/\.0$/, '')}</span>
            ))}
          </div>
          <div className="tl-lane tl-attempts">
            {state.attempts.map((a) => {
              const r = role(a)
              return (
                <div key={a.id} className={`tl-attempt ${r ? `tl-${r}` : ''}`} style={{ left: pct(a.start), width: pct(a.end - a.start) }}>
                  <span className="tl-attempt-label">
                    {r && <b>{r.toUpperCase()}</b>} {a.index}
                  </span>
                  {a.phases.map((p) => (
                    <span key={p.id} className={`tl-phase tl-phase-${p.id}`} style={{ left: `${((p.start - a.start) / (a.end - a.start)) * 100}%`, width: `${((p.end - p.start) / (a.end - a.start)) * 100}%` }} title={`${p.label}: ${formatTime(p.start)}–${formatTime(p.end)}`}>
                      {p.label}
                    </span>
                  ))}
                  {boundaries(a).map((b, k) => (
                    <span
                      key={k}
                      className={`tl-handle ${k === 0 || k === boundaries(a).length - 1 ? 'tl-handle-edge' : ''}`}
                      style={{ left: `${((b - a.start) / (a.end - a.start)) * 100}%` }}
                      onPointerDown={(e) => startDrag(e, a, k)}
                      title="Drag to adjust"
                    />
                  ))}
                </div>
              )
            })}
          </div>
          <div className="tl-lane tl-moments">
            {state.markers.map((m) => (
              <button
                key={m.id}
                className={`tl-moment ${m.author === 'companion' ? 'by-companion' : ''}`}
                style={{ left: pct(m.t) }}
                title={m.text || 'Moment'}
                onPointerDown={(e) => {
                  e.stopPropagation()
                  clock.seek(m.t)
                }}
              />
            ))}
          </div>
          <div className="tl-lane tl-quality">
            {spans.map((s) => (
              <span key={`${s.kind}${s.from}`} className={`tl-q tl-q-${s.kind}`} style={{ left: pct(s.from), width: pct(s.to - s.from) }} title={s.kind === 'missing' ? 'No pose tracked' : 'Low tracking confidence'} />
            ))}
          </div>
          <Playhead duration={duration} />
        </div>
      </div>
    </div>
  )
}
