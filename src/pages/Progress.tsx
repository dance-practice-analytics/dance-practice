// Progress: every measurement across sessions as small multiples on the same
// session axis, for one phase at a time. Change over time, never a score.

import { useMemo, useState } from 'react'
import type { MetricDefinition, PhaseId } from '../types'
import { sinceText, columnsFor, latestChange, useSessionsWithResults, type Column } from '../lib/acrossSessions'
import { PHASES } from '../lib/phases'
import { AppBar } from '../components/AppBar'
import { MetricIcon } from '../components/MetricIcon'
import { formatMeasure, SessionStrip, StripTable } from '../components/SessionStrip'
import { ErrorState, Spinner } from '../components/ui'
import { CountUp } from '../components/CountUp'

function Multiple({ metric, columns, asTable, phase, phaseLabel }: { metric: MetricDefinition | null; columns: Column[]; asTable: boolean; phase: PhaseId; phaseLabel: string }) {
  const now = latestChange(columns, metric)
  const measured = !metric || metric.phases.includes(phase)
  const name = metric ? metric.name : 'Time on relevé'
  return (
    <section className="card multiple">
      <header className="multiple-head">
        <div className="multiple-name">
          {metric ? <MetricIcon id={metric.id} /> : <span className="metric-icon-blank" />}
          <div>
            <h2>{name}</h2>
            <p>{metric ? metric.question : 'How long the heels stay up, across the whole attempt.'}</p>
          </div>
        </div>
        <div className="multiple-now">
          <b>{now.value === null ? '—' : <CountUp value={formatMeasure(now.value, metric)} />}</b>
          <small>{now.change ? sinceText(now.change, now.since!) : now.value === null ? (metric ? `not measured in ${phaseLabel}` : 'unavailable') : 'latest median'}</small>
        </div>
      </header>
      {!measured ? (
        <p className="card-empty">{name} isn’t measured during {phaseLabel}. Pick another phase.</p>
      ) : asTable ? (
        <StripTable columns={columns} metric={metric} />
      ) : (
        <SessionStrip key={phase} columns={columns} metric={metric} height={170} compact label={`${name}${metric ? `, ${phaseLabel}` : ''}`} />
      )}
    </section>
  )
}

export function Progress() {
  const { sessions, results, error } = useSessionsWithResults()
  const [phase, setPhase] = useState<PhaseId>('hold')
  const [asTable, setAsTable] = useState(false)
  const any = Object.values(results)[0]
  const phaseLabel = PHASES.find((p) => p.id === phase)!.label
  const grid = useMemo(() => {
    if (!sessions || !any) return []
    return [...any.metrics.map((m) => ({ metric: m as MetricDefinition | null, columns: columnsFor(sessions, results, m.id, phase) })), { metric: null, columns: columnsFor(sessions, results, 'releve') }]
  }, [sessions, results, any, phase])
  const notCompared = grid[0]?.columns.filter((c) => !c.comparable) ?? []

  return (
    <div className="app">
      <AppBar>
        <span className="page-title">Progress</span>
      </AppBar>
      <main className="main progress">
        {error && <ErrorState title="Progress didn’t load" message={error} action={<button className="btn" onClick={() => location.reload()}>Try again</button>} />}
        {!error && !any && <Spinner label="Reading your sessions…" />}
        {any && (
          <>
            <section className="home-head">
              <div>
                <p className="kicker">Across sessions</p>
                <h1>How your attempts change, session by session</h1>
                <p className="muted">Each dot is one attempt; the line joins each session’s median. All charts share the same sessions, so you can read down a column.</p>
              </div>
            </section>
            <div className="toolbar">
              <div className="seg" role="group" aria-label="Phase">
                <span className="toolbar-label">Phase</span>
                {PHASES.map((p) => (
                  <button key={p.id} className={`seg-btn ${phase === p.id ? 'on' : ''}`} onClick={() => setPhase(p.id)}>{p.label}</button>
                ))}
              </div>
              <button className="btn" onClick={() => setAsTable(!asTable)}>{asTable ? 'Show charts' : 'Show tables'}</button>
            </div>
            {notCompared.length > 0 && (
              <p className="note">
                <i className="swatch swatch-missing" /> {notCompared.map((c) => new Date(c.s.recordedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })).join(', ')}{' '}
                {notCompared.length === 1 ? 'was' : 'were'} filmed from a different camera view, so {notCompared.length === 1 ? 'it isn’t' : 'they aren’t'} compared with the front-view sessions.
              </p>
            )}
            <div className="multiples">
              {grid.map((g) => <Multiple key={g.metric?.id ?? 'releve'} metric={g.metric} columns={g.columns} asTable={asTable} phase={phase} phaseLabel={phaseLabel} />)}
            </div>
          </>
        )}
      </main>
    </div>
  )
}
