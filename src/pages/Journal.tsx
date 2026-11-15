// Home: what to focus on next, a few headline numbers, change across sessions
// and every session in one list. Values and change only, never a score.

import { useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import type { MetricDefinition, SessionResults, SessionStatus, SessionSummary } from '../types'
import { href, navigate, type Route } from '../router'
import { auth } from '../state/app'
import { createStore, useStore, type Store } from '../state/store'
import { sinceText, columnsFor, day, latestChange, useSessionsWithResults, type Measure } from '../lib/acrossSessions'
import { AppBar } from '../components/AppBar'
import { MetricIcon } from '../components/MetricIcon'
import { formatMeasure, SessionStrip, StripTable } from '../components/SessionStrip'
import { ErrorState, Spinner } from '../components/ui'
import { CountUp } from '../components/CountUp'
import { PhaseRhythm } from '../components/PhaseRhythm'
import { PoseLoop } from '../components/PoseLoop'
import { PHASE_LABEL } from '../lib/phases'
import { formatTime } from '../lib/format'
import { track } from '../study/log'

const STATUS: Record<SessionStatus, { label: string; action: string; route: (id: string) => Route }> = {
  awaiting_pose: { label: 'Waiting for pose data', action: 'Add pose data', route: (id) => ({ name: 'processing', id }) },
  processing: { label: 'Processing', action: 'See progress', route: (id) => ({ name: 'processing', id }) },
  failed: { label: 'Import needs attention', action: 'Fix import', route: (id) => ({ name: 'processing', id }) },
  needs_confirmation: { label: 'Confirm attempts', action: 'Confirm attempts', route: (id) => ({ name: 'confirm', id }) },
  ready: { label: 'Ready', action: 'Open', route: (id) => ({ name: 'workspace', id }) },
}

/** Heel height over the whole clip with the confirmed attempts shaded: the shape of the practice. */
function PracticeShape({ results }: { results: SessionResults }) {
  const { duration } = results.session
  const pts = results.series.heelLift
    .filter((_, i) => i % 3 === 0)
    .map((s) => (s.value === null ? null : `${((s.t / duration) * 100).toFixed(2)},${(30 - Math.max(0, Math.min(30, s.value)) * 0.9).toFixed(2)}`))
  const segs: string[][] = [[]]
  for (const p of pts) {
    if (p === null) segs.push([])
    else segs[segs.length - 1].push(p)
  }
  return (
    <svg className="shape" viewBox="0 0 100 32" preserveAspectRatio="none" aria-hidden="true">
      {results.attempts.map((a) => (
        <rect key={a.id} x={(a.start / duration) * 100} width={((a.end - a.start) / duration) * 100} y="0" height="32" className="shape-attempt" rx="1" />
      ))}
      {segs.filter((s) => s.length > 1).map((s, i) => <polyline key={i} points={s.join(' ')} className="shape-line" />)}
    </svg>
  )
}

function Kpi({ label, value, sub, icon }: { label: string; value: string; sub?: string; icon?: ReactNode }) {
  return (
    <div className="kpi">
      <div className="kpi-label">{icon}{label}</div>
      <div className="kpi-value"><CountUp value={value} /></div>
      <div className="kpi-sub">{sub ?? ' '}</div>
    </div>
  )
}

/** Five weeks of practice days, Monday first. Presence only, not a streak to keep up. */
function PracticeCalendar({ sessions }: { sessions: SessionSummary[] }) {
  const days = useMemo(() => {
    const localKey = (d: Date) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
    const byDay = new Set(sessions.map((s) => localKey(new Date(s.recordedAt))))
    const today = new Date()
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() + ((7 - today.getDay()) % 7) - 34)
    return Array.from({ length: 35 }, (_, i) => {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)
      const key = localKey(d)
      return { key, d, on: byDay.has(key), future: d > today, today: key === localKey(today) }
    })
  }, [sessions])
  const count = days.filter((d) => d.on).length
  return (
    <div className="cal">
      <div className="cal-grid" role="img" aria-label={`${count} practice days in the last five weeks`}>
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((l, i) => <span key={i} className="cal-head">{l}</span>)}
        {days.map((d, i) => (
          <span key={d.key} style={{ '--i': i } as CSSProperties} className={`cal-day ${d.on ? 'on' : ''} ${d.future ? 'future' : ''} ${d.today ? 'today' : ''}`} title={`${day(d.d.toISOString(), { weekday: 'short', month: 'short', day: 'numeric' })}${d.on ? ' · practice session' : ''}`} />
        ))}
      </div>
      <p className="cal-note">{count} practice {count === 1 ? 'day' : 'days'} in the last five weeks</p>
    </div>
  )
}

function ProgressCard({ sessions, results }: { sessions: SessionSummary[]; results: Record<string, SessionResults> }) {
  const [measure, setMeasure] = useState<Measure>('kneeToe')
  const [asTable, setAsTable] = useState(false)
  const any = Object.values(results)[0]
  const metric = measure === 'releve' ? null : any.metrics.find((m) => m.id === measure)!
  const columns = useMemo(() => columnsFor(sessions, results, measure), [sessions, results, measure])
  const title = metric ? `${metric.name} during the hold` : 'Time on relevé'
  return (
    <section className="card progress-card">
      <header className="card-head">
        <div>
          <h2>Across sessions</h2>
          <p>{title}. One dot per attempt, line through each session’s median. Front-view sessions only.</p>
        </div>
        <div className="card-tools">
          <a className="link-btn" href={href({ name: 'progress' })}>All measurements →</a>
          <button className="link-btn" onClick={() => setAsTable(!asTable)}>{asTable ? 'Chart' : 'Table'}</button>
        </div>
      </header>
      <div className="tabs-inline" role="tablist" aria-label="Measurement">
        {any.metrics.map((m) => (
          <button key={m.id} role="tab" aria-selected={measure === m.id} className={measure === m.id ? 'on' : ''} onClick={() => setMeasure(m.id)}>
            <MetricIcon id={m.id} /> {m.name}
          </button>
        ))}
        <button role="tab" aria-selected={measure === 'releve'} className={measure === 'releve' ? 'on' : ''} onClick={() => setMeasure('releve')}>Time on relevé</button>
      </div>
      {asTable ? <StripTable columns={columns} metric={metric} /> : <SessionStrip key={measure} columns={columns} metric={metric} height={230} label={title} />}
      {!asTable && (
        <div className="legend legend-quality">
          <span><i className="swatch swatch-median" /> session median</span>
          <span><i className="swatch swatch-missing" /> different camera view, not compared</span>
        </div>
      )}
    </section>
  )
}

function SessionsTable({ sessions, results }: { sessions: SessionSummary[]; results: Record<string, SessionResults> }) {
  return (
    <section className="card">
      <header className="card-head">
        <div>
          <h2>Sessions</h2>
          <p>Each session is one clip of a few attempts at the same movement.</p>
        </div>
      </header>
      <div className="sessions-table" role="table" aria-label="Sessions">
        <div className="st-row st-headrow" role="row">
          <span role="columnheader">Date</span>
          <span role="columnheader">Goal</span>
          <span role="columnheader" className="st-hide-sm">Recording</span>
          <span role="columnheader" className="st-hide-md">Shape of the practice</span>
          <span role="columnheader">Status</span>
          <span role="columnheader" className="sr-only">Action</span>
        </div>
        {sessions.map((s) => {
          const st = STATUS[s.status]
          const to = st.route(s.id)
          const r = results[s.id]
          return (
            <a key={s.id} className="st-row" role="row" href={href(to)} onClick={() => track('journal.open_session', { status: s.status })}>
              <span role="cell" className="st-date">
                <b>{new Date(s.recordedAt).getDate()}</b>
                <small>{day(s.recordedAt, { month: 'short' })} · {day(s.recordedAt, { weekday: 'short' })}</small>
              </span>
              <span role="cell" className="st-goal">
                <b>{s.goal || 'No goal written'}</b>
                {s.reflection && <small>{s.reflection}</small>}
              </span>
              <span role="cell" className="st-hide-sm st-cond">
                <span className={`view-tag ${s.conditions.view !== 'front' ? 'other' : ''}`}>{s.conditions.view}</span>
                <small>{s.conditions.distance} · {s.conditions.music ? 'music' : 'no music'}{s.attemptCount > 0 ? ` · ${s.attemptCount} attempts` : ''}</small>
              </span>
              <span role="cell" className="st-hide-md st-shape">{r && r.attempts.length > 0 ? <PracticeShape results={r} /> : <span className="muted small">—</span>}</span>
              <span role="cell"><span className={`status status-${s.status}`}>{st.label}</span></span>
              <span role="cell" className="st-go" aria-hidden="true">{st.action} →</span>
            </a>
          )
        })}
      </div>
    </section>
  )
}

function LiveRhythm({ attempts, time }: { attempts: SessionResults['attempts']; time: Store<number | null> }) {
  return <PhaseRhythm attempts={attempts} time={useStore(time)} />
}

function LivePhase({ attempts, time }: { attempts: SessionResults['attempts']; time: Store<number | null> }) {
  const t = useStore(time)
  if (t === null) return null
  const a = attempts.find((x) => t >= x.start && t <= x.end)
  const p = a?.phases.find((x) => t >= x.start && t < x.end)
  return (
    <div className="spot-hud">
      <b>{a ? `Attempt ${a.index}` : 'Between attempts'}</b>
      <span>{p ? PHASE_LABEL[p.id] : '—'}</span>
      <code>{formatTime(t)}</code>
    </div>
  )
}

/** The latest reviewed session replayed as a skeleton, with how long each phase of each attempt took. */
function Spotlight({ s, r }: { s: SessionSummary; r: SessionResults }) {
  const time = useMemo(() => createStore<number | null>(null), [])
  const first = r.attempts[0]
  const last = r.attempts[r.attempts.length - 1]
  return (
    <section className="card spotlight">
      <div className="spot-stage">
        <PoseLoop pose={r.pose} fps={r.session.fps} from={Math.max(0, first.start - 0.5)} to={last.end + 0.5} onTime={time.set} label="Your latest session, replayed as a skeleton" />
        <span className="spot-tag"><span className="live-dot" /> Replay</span>
        <LivePhase attempts={r.attempts} time={time} />
      </div>
      <div className="spot-body">
        <header className="card-head">
          <div>
            <p className="kicker">Latest session · {day(s.recordedAt, { weekday: 'short', month: 'short', day: 'numeric' })}</p>
            <h2 className="spot-goal">{s.goal || 'No goal written'}</h2>
            <p>Phase rhythm: how long each attempt spent in each phase, on the same time scale. The replay on the left runs through the whole clip.</p>
          </div>
          <a className="btn" href={href({ name: 'workspace', id: s.id })}>Open review →</a>
        </header>
        <LiveRhythm attempts={r.attempts} time={time} />
      </div>
    </section>
  )
}

function headline(sessions: SessionSummary[], results: Record<string, SessionResults>) {
  const any = Object.values(results)[0]
  const knee: MetricDefinition | undefined = any?.metrics.find((m) => m.id === 'kneeToe')
  const kneeCols = any ? columnsFor(sessions, results, 'kneeToe') : []
  const relCols = any ? columnsFor(sessions, results, 'releve') : []
  return {
    knee,
    kneeNow: knee ? latestChange(kneeCols, knee) : null,
    relNow: any ? latestChange(relCols, null) : null,
    attempts: sessions.filter((s) => s.status === 'ready').reduce((n, s) => n + s.attemptCount, 0),
    recent: sessions.filter((s) => Date.now() - new Date(s.recordedAt).getTime() < 14 * 864e5).length,
  }
}

export function Journal() {
  const { sessions, results, error } = useSessionsWithResults()
  const a = useStore(auth)
  const name = a.status === 'signedIn' ? a.account.participant : ''
  const nextFrom = useMemo(() => sessions?.find((s) => s.nextGoal), [sessions])
  const todo = sessions?.filter((s) => s.status !== 'ready') ?? []
  const h = sessions ? headline(sessions, results) : null
  const hasResults = Object.keys(results).length > 0
  const latest = sessions?.filter((s) => results[s.id]?.attempts.length).sort((x, y) => y.recordedAt.localeCompare(x.recordedAt))[0]

  return (
    <div className="app">
      <AppBar actions={<button className="btn btn-primary" onClick={() => navigate({ name: 'new' })}>+ New session</button>}>
        <span className="page-title">Home</span>
      </AppBar>
      <main className="main home">
        {error && <ErrorState title="Your journal didn’t load" message={error} action={<button className="btn" onClick={() => location.reload()}>Try again</button>} />}
        {!sessions && !error && <Spinner label="Loading your practice journal…" />}
        {sessions && (
          <>
            <section className="home-head">
              <div>
                <p className="kicker">Relevé balance in parallel</p>
                <h1>Welcome back{name ? `, ${name}` : ''}</h1>
              </div>
            </section>

            {sessions.length === 0 ? (
              <div className="empty-journal">
                <h2>No sessions yet</h2>
                <p>Start with a short clip of 3–5 attempts at a relevé balance in parallel, filmed from the front.</p>
                <button className="btn btn-primary btn-lg" onClick={() => navigate({ name: 'new' })}>Record your first session</button>
              </div>
            ) : (
              <>
                <section className="home-top">
                  <div className="focus-card">
                    <p className="kicker">Your next focus</p>
                    <p className="focus-text">{nextFrom?.nextGoal ? `“${nextFrom.nextGoal}”` : 'Write a next goal when you finish reflecting on a session.'}</p>
                    {nextFrom && <p className="focus-from">From your reflection on {day(nextFrom.recordedAt, { month: 'long', day: 'numeric' })}</p>}
                    <button className="btn btn-on" onClick={() => navigate({ name: 'new' })}>Start a session →</button>
                  </div>
                  <div className="kpis">
                    <Kpi label="Sessions" value={String(sessions.length)} sub={`${h!.recent} in the last two weeks`} />
                    <Kpi label="Attempts reviewed" value={String(h!.attempts)} sub="confirmed by you" />
                    <Kpi
                      icon={<MetricIcon id="kneeToe" />}
                      label="Knee over toes, hold"
                      value={h!.kneeNow?.value != null && h!.knee ? formatMeasure(h!.kneeNow.value, h!.knee) : hasResults ? '—' : '…'}
                      sub={h!.kneeNow?.change ? sinceText(h!.kneeNow.change, h!.kneeNow.since!) : 'latest front-view median'}
                    />
                    <Kpi
                      label="Time on relevé"
                      value={h!.relNow?.value != null ? formatMeasure(h!.relNow.value, null) : hasResults ? '—' : '…'}
                      sub={h!.relNow?.change ? sinceText(h!.relNow.change, h!.relNow.since!) : 'latest front-view median'}
                    />
                  </div>
                </section>

                {latest && <Spotlight s={latest} r={results[latest.id]} />}

                <section className="home-grid">
                  {hasResults ? <ProgressCard sessions={sessions} results={results} /> : <section className="card"><Spinner label="Reading measurements…" /></section>}
                  <aside className="home-side">
                    <section className="card">
                      <header className="card-head"><div><h2>Practice days</h2></div></header>
                      <PracticeCalendar sessions={sessions} />
                    </section>
                    <section className="card">
                      <header className="card-head"><div><h2>To do</h2></div></header>
                      {todo.length === 0 ? (
                        <p className="card-empty">Nothing waiting. Every session is ready to review.</p>
                      ) : (
                        <ul className="todo">
                          {todo.map((s) => {
                            const st = STATUS[s.status]
                            return (
                              <li key={s.id}>
                                <span className={`status status-${s.status}`}>{st.label}</span>
                                <span className="todo-goal">{day(s.recordedAt)} · {s.goal || 'No goal'}</span>
                                <a className="btn btn-primary btn-sm" href={href(st.route(s.id))}>{st.action}</a>
                              </li>
                            )
                          })}
                        </ul>
                      )}
                    </section>
                  </aside>
                </section>

                <SessionsTable sessions={sessions} results={results} />
              </>
            )}
          </>
        )}
      </main>
    </div>
  )
}
