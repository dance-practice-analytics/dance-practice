// "Change, not score": A vs B per metric as dumbbells, for one phase.

import type { MetricDefinition, PhaseId } from '../types'
import { useStudio } from '../state/studio'
import { describeChange, formatValue } from '../lib/format'

const PHASES: { id: PhaseId; label: string }[] = [
  { id: 'prep', label: 'Plié' },
  { id: 'rise', label: 'Rise' },
  { id: 'hold', label: 'Hold' },
  { id: 'release', label: 'Lower' },
]

function Dumbbell({ a, b, domain, format }: { a: number; b: number; domain: [number, number]; format: (v: number) => string }) {
  const [lo, hi] = domain
  const x = (v: number) => ((Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo)) * 100
  return (
    <div className="dumbbell" role="img" aria-label={`A ${format(a)}, B ${format(b)}`}>
      <span className="db-axis" />
      {lo < 0 && <span className="db-zero" style={{ left: `${x(0)}%` }} />}
      <span className="db-link" style={{ left: `${Math.min(x(a), x(b))}%`, width: `${Math.abs(x(b) - x(a))}%` }} />
      <span className="db-dot db-a" style={{ left: `${x(a)}%` }} />
      <span className="db-dot db-b" style={{ left: `${x(b)}%` }} />
    </div>
  )
}

export function ComparePanel() {
  const { results, state, dispatch, summary, releve, attemptById } = useStudio()
  const a = attemptById(state.compare.a)
  const b = attemptById(state.compare.b)
  const phase = state.compare.phase
  const phaseLabel = PHASES.find((p) => p.id === phase)!.label

  const differences = (Object.keys(a.context) as (keyof typeof a.context)[]).filter((k) => a.context[k] !== b.context[k])
  const viewsDiffer = differences.includes('view')

  const row = (m: MetricDefinition) => {
    const sa = summary(a.id, phase, m.id)
    const sb = summary(b.id, phase, m.id)
    const ok = sa.available && sb.available && !viewsDiffer
    return (
      <div className="cmp-row" key={m.id}>
        <div className="cmp-name">{m.name}</div>
        {ok ? (
          <>
            <Dumbbell a={sa.mean!} b={sb.mean!} domain={m.domain} format={(v) => formatValue(v, m)} />
            <div className="cmp-values">
              <span className="val-a">{formatValue(sa.mean, m, false)}</span>
              <span className="arrow">→</span>
              <span className="val-b">{formatValue(sb.mean, m)}</span>
              <span className="cmp-change">B is {describeChange(sa.mean!, sb.mean!, m)}</span>
            </div>
          </>
        ) : (
          <div className="cmp-na">{viewsDiffer ? 'Camera views differ, so this is not compared' : (!sa.available ? sa.reason : sb.reason) ?? 'Unavailable'}</div>
        )}
      </div>
    )
  }

  const ra = releve[a.id]
  const rb = releve[b.id]

  return (
    <div className="panel compare-panel">
      <div className="panel-head">
        <div>
          <div className="panel-title">
            Compare <span className="tag-a">A · {a.index}</span> and <span className="tag-b">B · {b.index}</span>
          </div>
          <div className="panel-sub">Averages during one phase. This shows change, not a score.</div>
        </div>
        <button className={`btn ${state.mode === 'compare' ? 'btn-on' : ''}`} onClick={() => dispatch({ type: 'setMode', mode: state.mode === 'compare' ? 'review' : 'compare' })}>
          {state.mode === 'compare' ? 'Back to review' : 'Watch side by side'}
        </button>
      </div>
      <div className="seg seg-phases" role="group" aria-label="Phase to compare">
        {PHASES.map((p) => (
          <button key={p.id} className={`seg-btn ${phase === p.id ? 'on' : ''}`} onClick={() => dispatch({ type: 'setCompare', phase: p.id })}>
            {p.label}
          </button>
        ))}
      </div>
      {differences.length > 0 && (
        <p className={`cmp-note ${viewsDiffer ? 'warn' : ''}`}>
          {viewsDiffer ? 'These attempts were filmed from different views. ' : 'Conditions differed: '}
          {differences.map((k) => (k === 'view' ? null : k === 'music' ? 'music' : 'tiredness')).filter(Boolean).join(' and ')}
          {viewsDiffer ? '' : '. Keep that in mind when reading the change.'}
        </p>
      )}
      <div className="cmp-rows">
        {results.metrics.map(row)}
        <div className="cmp-row">
          <div className="cmp-name">Time on relevé</div>
          {ra !== null && rb !== null ? (
            <>
              <Dumbbell a={ra} b={rb} domain={[0, 4]} format={(v) => `${v.toFixed(1)} s`} />
              <div className="cmp-values">
                <span className="val-a">{ra.toFixed(1)}</span>
                <span className="arrow">→</span>
                <span className="val-b">{rb.toFixed(1)} s</span>
                <span className="cmp-change">whole attempt</span>
              </div>
            </>
          ) : (
            <div className="cmp-na">A tracking gap means this can't be measured for attempt {ra === null ? a.index : b.index}</div>
          )}
        </div>
      </div>
      <p className="cmp-foot">Phase: {phaseLabel}. Only attempts with the same metric version and camera view are compared.</p>
    </div>
  )
}
