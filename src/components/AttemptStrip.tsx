// Small multiples: every attempt in the session, with the focus metric's
// trace, so the dancer can pick which two to compare.

import type { Attempt, AttemptContext, MetricDefinition } from '../types'
import { useStudio } from '../state/studio'
import { clock, useClockTime } from '../state/clock'
import { PhaseRhythm } from './PhaseRhythm'
import { appliesIn, sampleAt } from '../lib/series'
import { phaseAt } from '../lib/attempts'
import { formatTime, formatValue } from '../lib/format'
import { useAttemptAtPlayhead } from '../lib/hooks'

const CONTEXT_LABEL: { [K in keyof AttemptContext]: (v: AttemptContext[K]) => string } = {
  view: (v) => `${v} view`,
  music: (v) => (v ? 'with music' : 'no music'),
  fatigue: (v) => v,
}

function Sparkline({ attempt, metric }: { attempt: Attempt; metric: MetricDefinition }) {
  const { results } = useStudio()
  const { fps } = results.session
  const [lo, hi] = metric.domain
  const span = attempt.end - attempt.start
  const segments: string[][] = [[]]
  for (let t = attempt.start; t <= attempt.end; t += 2 / fps) {
    const v = appliesIn(metric, phaseAt(attempt, t)?.id) ? sampleAt(results.series[metric.id], t, fps).value : null
    if (v === null) {
      if (segments[segments.length - 1].length) segments.push([])
      continue
    }
    segments[segments.length - 1].push(`${(((t - attempt.start) / span) * 100).toFixed(2)},${(36 - ((v - lo) / (hi - lo)) * 36).toFixed(2)}`)
  }
  return (
    <svg className="spark" viewBox="0 0 100 36" preserveAspectRatio="none" aria-hidden="true">
      {attempt.phases.map((p, i) =>
        i % 2 === 0 ? <rect key={p.id} x={((p.start - attempt.start) / span) * 100} width={((p.end - p.start) / span) * 100} y="0" height="36" className="spark-band" /> : null,
      )}
      {lo < 0 && <line x1="0" x2="100" y1={36 - ((0 - lo) / (hi - lo)) * 36} y2={36 - ((0 - lo) / (hi - lo)) * 36} className="spark-zero" />}
      {segments.filter((s) => s.length > 1).map((s, i) => <polyline key={i} points={s.join(' ')} className="spark-line" />)}
    </svg>
  )
}

/** Phase durations per attempt with the playhead; a phase jumps the clip there. */
function Rhythm() {
  const { state, dispatch } = useStudio()
  const time = useClockTime()
  return (
    <section className="rhythm-panel">
      <div className="panel-sub">Phase rhythm · click a phase to play from it</div>
      <PhaseRhythm
        attempts={state.attempts}
        time={time}
        roles={{ [state.compare.a]: 'a', [state.compare.b]: 'b' }}
        onSeek={(t) => {
          dispatch({ type: 'setMode', mode: 'review' })
          clock.seek(t)
        }}
      />
    </section>
  )
}

export function AttemptStrip() {
  const { state, dispatch, metric, summary, releve } = useStudio()
  const focus = metric(state.focusMetric)
  const current = useAttemptAtPlayhead(state.attempts)
  const phase = state.compare.phase

  return (
    <div className="panel">
      <div className="panel-head">
        <div>
          <div className="panel-title">Attempts in this session</div>
          <div className="panel-sub">Showing {focus.name.toLowerCase()}. Pick A and B to compare.</div>
        </div>
      </div>
      <Rhythm />
      <div className="attempt-grid">
        {state.attempts.map((a) => {
          const role = a.id === state.compare.a ? 'a' : a.id === state.compare.b ? 'b' : null
          const s = summary(a.id, phase, focus.id)
          const rt = releve[a.id]
          return (
            <article key={a.id} className={`attempt-card ${role ? `role-${role}` : ''} ${current.id === a.id ? 'is-current' : ''}`}>
              <header>
                <button className="attempt-title" onClick={() => { dispatch({ type: 'setMode', mode: 'review' }); clock.seek(a.start) }} title="Play from this attempt">
                  Attempt {a.index}
                  <small>{formatTime(a.start)}–{formatTime(a.end)}</small>
                </button>
                <div className="ab-pick" role="group" aria-label={`Use attempt ${a.index} as`}>
                  <button className={role === 'a' ? 'on-a' : ''} onClick={() => dispatch({ type: 'setCompare', a: a.id })}>A</button>
                  <button className={role === 'b' ? 'on-b' : ''} onClick={() => dispatch({ type: 'setCompare', b: a.id })}>B</button>
                </div>
              </header>
              <Sparkline attempt={a} metric={focus} />
              <dl className="attempt-stats">
                <div>
                  <dt>{a.phases.find((p) => p.id === phase)?.label} average</dt>
                  <dd title={s.reason}>{s.available ? formatValue(s.mean, focus) : <span className="na">unavailable</span>}</dd>
                </div>
                <div>
                  <dt>Time on relevé</dt>
                  <dd title={rt === null ? 'Tracking gap in this attempt' : undefined}>{rt === null ? <span className="na">unavailable</span> : `${rt.toFixed(1)} s`}</dd>
                </div>
              </dl>
              <div className="tags">
                {(Object.keys(CONTEXT_LABEL) as (keyof AttemptContext)[]).map((k) => (
                  <button key={k} className="tag" onClick={() => dispatch({ type: 'cycleContext', attemptId: a.id, key: k })} title="Click to change">
                    {(CONTEXT_LABEL[k] as (v: AttemptContext[typeof k]) => string)(a.context[k])}
                  </button>
                ))}
              </div>
            </article>
          )
        })}
      </div>
    </div>
  )
}
