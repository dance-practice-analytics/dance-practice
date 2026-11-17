// Screen 9 — Progress (FR-3.6.3, FR-3.6.4).
// Design: Progress.dc.html, ProgressMobile.dc.html; "Progress needs two sessions" in States.dc.html.
// One small chart per measurement, all sessions on one scale, like with like only (one
// movement, one camera view). Values, medians and neutral change text come from
// src/insights/progress.ts. Nothing here says better or worse.

import { useMemo, useState } from 'react'
import type { CameraView, MovementType } from '../../data/schema'
import { CompactGap, EmptyState, ErrorAlert, PageHeader, Skeleton } from '../components'
import { latestProcessed, useLibrary } from '../data'
import { compactGapReason, isCompactGap, METRICS, MOVEMENT_LABELS, VIEW_LABELS, type MetricKey } from '../format'
import { href } from '../router'
import { useIsNarrow } from '../useIsNarrow'
import { ProgressChart, ProgressLegend } from './progress/ProgressChart'
import { buildProgress, DATE_RANGES, defaultMovement, tableRows, type DateRange, type MetricPanel, type ProgressView } from './progress/model'
import './progress/progress.css'

const MOVEMENTS: MovementType[] = ['releve_balance', 'pirouette']

export function Progress() {
  const library = useLibrary()
  const narrow = useIsNarrow()
  const [pickedMovement, setMovement] = useState<MovementType | null>(null)
  const [cameraView, setCameraView] = useState<CameraView | undefined>(undefined)
  const [range, setRange] = useState<DateRange>('all')
  // Days of the 'Custom…' range; kept while another range is picked.
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [tableMetric, setTableMetric] = useState<MetricKey | null>(null)

  const data = library.data
  const movement = pickedMovement ?? defaultMovement(data?.sessions ?? [])
  const view = useMemo(
    () => (data ? buildProgress(data.sessions, data.attempts, { movement, cameraView, range, from, to }) : null),
    [data, movement, cameraView, range, from, to],
  )

  const pickMovement = (m: MovementType) => {
    setMovement(m)
    // A view picked for one movement may not exist for the other.
    setCameraView(undefined)
    setTableMetric(null)
  }

  const movementTabs = (block?: boolean) => (
    <div className="seg" role="tablist" aria-label="Movement" style={block ? { width: '100%' } : undefined}>
      {MOVEMENTS.map((m) => (
        <button
          key={m}
          type="button"
          role="tab"
          aria-selected={m === movement}
          className={m === movement ? 'on' : undefined}
          onClick={() => pickMovement(m)}
          style={block ? { flex: 1, justifyContent: 'center', height: 40 } : undefined}
        >
          {MOVEMENT_LABELS[m]}
        </button>
      ))}
    </div>
  )

  return (
    <>
      <PageHeader
        title="Progress"
        eyebrow={narrow ? `${MOVEMENT_LABELS[movement]} · your attempts` : undefined}
        subtitle="Your own attempts across sessions. Each chart keeps one scale for all sessions."
        actions={movementTabs()}
      />
      {narrow && movementTabs(true)}

      {library.error && <ErrorAlert error={library.error} onRetry={library.refetch} />}

      {library.loading ? (
        <ProgressSkeleton />
      ) : view && data ? (
        <ProgressBody
          view={view}
          range={range}
          setRange={setRange}
          from={from}
          to={to}
          setFrom={setFrom}
          setTo={setTo}
          setCameraView={setCameraView}
          tableMetric={tableMetric && view.panels.some((p) => p.key === tableMetric) ? tableMetric : (view.panels[0]?.key ?? null)}
          setTableMetric={setTableMetric}
          reviewHref={(sessionId) => {
            const latest = latestProcessed(data.attempts.filter((a) => a.session_id === sessionId))
            return latest ? href({ name: 'review', attemptId: latest.id }) : href({ name: 'library', sessionId })
          }}
        />
      ) : null}
    </>
  )
}

interface BodyProps {
  view: ProgressView
  range: DateRange
  setRange(r: DateRange): void
  from: string
  to: string
  setFrom(v: string): void
  setTo(v: string): void
  setCameraView(v: CameraView | undefined): void
  tableMetric: MetricKey | null
  setTableMetric(k: MetricKey): void
  reviewHref(sessionId: string): string
}

function ProgressBody(props: BodyProps) {
  const { view, range, setRange, from, to, setFrom, setTo, setCameraView, tableMetric, setTableMetric, reviewHref } = props
  const movementName = MOVEMENT_LABELS[view.movement]
  const filtered = range !== 'all'
  const clearDates = () => setRange('all')

  // No session of this movement at all: nothing to filter, one next step.
  if (view.movementSessions === 0) {
    return (
      <EmptyState
        icon="progress"
        title={`No ${movementName} sessions yet`}
        action={
          <a className="btn btn-primary" href={href({ name: 'import' })}>
            Import clips
          </a>
        }
      >
        Change over time appears here after two sessions of the same movement, filmed from the same camera view.
      </EmptyState>
    )
  }

  const tablePanel = view.panels.find((p) => p.key === tableMetric) ?? null
  const one = view.sessions.length === 1 ? view.sessions[0] : null

  return (
    <>
      <div className="v2-prog-filters">
        {view.views.length > 0 && (
          <div className="field" style={{ flex: '0 1 auto' }}>
            <span className="field-label" id="prog-view-label">
              Camera view
            </span>
            <div className="seg" role="radiogroup" aria-labelledby="prog-view-label">
              {view.views.map((v) => (
                <button
                  key={v}
                  type="button"
                  role="radio"
                  aria-checked={v === view.cameraView}
                  className={v === view.cameraView ? 'on' : undefined}
                  onClick={() => setCameraView(v)}
                >
                  {VIEW_LABELS[v]}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="field" style={{ flex: '0 1 auto' }}>
          <span className="field-label" id="prog-range-label">
            Dates
          </span>
          <div className="seg" role="radiogroup" aria-labelledby="prog-range-label">
            {DATE_RANGES.map((r) => (
              <button
                key={r.key}
                type="button"
                role="radio"
                aria-checked={r.key === range}
                className={r.key === range ? 'on' : undefined}
                onClick={() => setRange(r.key)}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
        {range === 'custom' && (
          <>
            <label className="field">
              <span className="field-label">From</span>
              <input className="input input-sm" type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
            </label>
            <label className="field">
              <span className="field-label">To</span>
              <input className="input input-sm" type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
            </label>
          </>
        )}
      </div>

      {view.sessions.length === 0 ? (
        <EmptyState
          icon="filter"
          title="No sessions match these filters"
          action={
            filtered ? (
              <button className="btn btn-ghost" type="button" onClick={clearDates}>
                Show all dates
              </button>
            ) : undefined
          }
        >
          {movementName} has {view.movementSessions === 1 ? 'one session' : `${view.movementSessions} sessions`}, none in this camera view and
          date range. The reasons are listed below.
        </EmptyState>
      ) : (
        <>
          {one && (
            <EmptyState
              icon="progress"
              title="Progress needs two sessions"
              action={
                <a className="btn btn-secondary" href={reviewHref(one.sessionId)}>
                  Review this session
                </a>
              }
            >
              You have one session of {movementName}
              {view.cameraView && view.cameraView !== 'unknown' ? ` in ${VIEW_LABELS[view.cameraView].toLowerCase()}` : ''}. After the next one,
              change over time appears here. Its attempts are shown below.
            </EmptyState>
          )}

          <div className="v2-prog-legend t-small muted">
            <ProgressLegend />
            <span style={{ flex: 1 }} />
            <span>{view.sessionsNote}</span>
          </div>

          <div className="v2-prog-grid">
            {view.panels.filter((p) => !isCompactPanel(p)).map((panel) => (
              <figure key={panel.key} className="card v2-prog-card">
                <figcaption style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                  <span className="t-small" style={{ fontWeight: 600 }}>
                    {panel.series.info.label}
                  </span>
                  {panel.phaseLabel && <span className="tag">{panel.phaseLabel}</span>}
                </figcaption>
                <ProgressChart panel={panel} sessions={view.sessions} />
                <p className="t-small muted">{panel.summary}</p>
              </figure>
            ))}
            {view.panels.filter(isCompactPanel).map((panel) => (
              <CompactGap
                key={panel.key}
                name={panel.series.info.label}
                reason={panel.series.points[0]?.gap?.nullReason}
                detail={compactDetail(panel)}
              />
            ))}
          </div>

          {tablePanel && (
            <section className="card" style={{ overflow: 'hidden' }} aria-labelledby="prog-table-h">
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', padding: '16px 16px 12px' }}>
                <h2 className="t-h3" id="prog-table-h" style={{ flex: '1 1 160px' }}>
                  Sessions
                </h2>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }} role="group" aria-label="Measurement shown in the table">
                  {view.panels.map((p) => (
                    <button
                      key={p.key}
                      type="button"
                      className={p.key === tablePanel.key ? 'chip on' : 'chip'}
                      aria-pressed={p.key === tablePanel.key}
                      onClick={() => setTableMetric(p.key)}
                    >
                      {METRICS[p.key].label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="tbl-wrap">
                <table className="tbl">
                  <caption className="v2-sr">
                    {tablePanel.series.info.label} of every attempt, by session. {tablePanel.series.info.description}
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Session</th>
                      <th scope="col">Attempts, in order</th>
                      <th scope="col" className="r">
                        Counted
                      </th>
                      <th scope="col" className="r">
                        Median
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {tableRows(tablePanel, view.names).map((row) => (
                      <tr key={row.sessionId}>
                        <th scope="row" style={{ fontWeight: 500, padding: 12, borderBottom: '1px solid var(--line)', color: 'var(--text)', fontSize: 13, whiteSpace: 'normal' }}>
                          <a href={reviewHref(row.sessionId)} style={{ whiteSpace: 'nowrap' }}>
                            {row.name}
                          </a>
                          <span className="t-caption" style={{ display: 'block' }}>
                            {row.title ? `${row.dateLabel} · ${row.title}` : row.dateLabel}
                          </span>
                        </th>
                        <td>
                          <span className="v2-prog-values num">
                            {row.values.map((v, i) => (
                              <span key={v.attemptId} title={v.note ?? undefined} className={v.note ? 'subtle' : undefined}>
                                {v.text}
                                {v.note && <span className="v2-sr"> ({v.note})</span>}
                                {i < row.values.length - 1 ? ',' : ''}
                              </span>
                            ))}
                          </span>
                          {notesOf(row.values).map((n) => (
                            <span key={n} className="t-caption" style={{ display: 'block' }} aria-hidden="true">
                              {n}
                            </span>
                          ))}
                        </td>
                        <td className="r num">
                          {row.counted} of {row.values.length}
                        </td>
                        <td className="r num" style={{ fontWeight: 600 }}>
                          {row.medianText}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="t-caption" style={{ padding: '10px 16px 14px' }}>
                The median uses values with medium or high confidence. A dash is an attempt without a value; it is never counted as 0.
              </p>
            </section>
          )}
        </>
      )}

      {view.excluded.length > 0 && (
        <section className="card" style={{ overflow: 'hidden' }} aria-labelledby="prog-excluded-h">
          <div style={{ padding: '16px 16px 12px', display: 'flex', flexDirection: 'column', gap: 4 }}>
            <h2 className="t-h3" id="prog-excluded-h">
              Sessions not shown
            </h2>
            <p className="t-small muted">Only sessions of the same movement and camera view are put on one chart.</p>
          </div>
          <ul className="v2-prog-excluded t-small">
            {view.excluded.map((e) => (
              <li key={e.sessionId}>
                <a href={href({ name: 'library', sessionId: e.sessionId })}>{e.what}</a>
                <span className="muted">{e.reason}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  )
}

/**
 * Every attempt shown lacks this value only because the clip had nothing to measure (e.g.
 * no plié for "Knee over toes"): a slim row below the charts instead of an empty chart.
 */
function isCompactPanel(panel: MetricPanel): boolean {
  const { points, state } = panel.series
  return state === 'no_data' && points.length > 0 && points.every((p) => p.value === null && isCompactGap(p.gap?.nullReason))
}

function compactDetail(panel: MetricPanel): string | undefined {
  const many = panel.series.points.length > 1
  return many && compactGapReason(panel.series.points[0]?.gap?.nullReason) === 'knee_not_bent' ? 'no plié in any clip' : undefined
}

/** The distinct reasons behind the dashes and uncounted values of one table row. */
function notesOf(values: readonly { note: string | null }[]): string[] {
  const counts = new Map<string, number>()
  for (const v of values) if (v.note) counts.set(v.note, (counts.get(v.note) ?? 0) + 1)
  return [...counts].map(([note, n]) => (n === values.length ? `${note}.` : `${n} of ${values.length}: ${note}.`))
}

function ProgressSkeleton() {
  return (
    <div className="v2-prog-grid" aria-busy="true" aria-label="Loading progress">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="card v2-prog-card">
          <Skeleton height={14} width="50%" />
          <Skeleton height={120} radius={8} />
          <Skeleton height={12} width="80%" />
        </div>
      ))}
    </div>
  )
}
