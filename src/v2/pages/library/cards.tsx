// Pieces the Library and the Dashboard both show: the attempt tile, the "Next focus"
// card (from stored practice notes, else a "Next step" from the dancer's own clips) and the "Trend" card (session medians).
// Design: Library.dc.html, LibraryMobile.dc.html, Dashboard.dc.html.

import { useId, useMemo, useState, type CSSProperties } from 'react'
import { AttemptThumb, CompactGap, Icon, Skeleton } from '../../components'
import type { AttemptView } from '../../data'
import { isCompactGap, METRICS, metricsFor, type MetricKey } from '../../format'
import { usePipelineItem } from '../../pipeline'
import { href } from '../../router'
import { layoutSeries } from './chart'
import { ONE_SESSION_HINT, TILE_LABEL, buildTrend, firstSentence, hasSingleValue, tileStatus, type Focus, type NextFocus, type TileKind, type Trend } from './model'
import type { NextStep } from './nextStep'
import type { AccountNotes } from './notes'

// ---------- attempt tile ----------

/** The tile's words; a clip in this tab's queue shows its live percentage. */
export function useTileLabel(attemptId: string, kind: TileKind): string {
  const item = usePipelineItem(attemptId)
  if (kind === 'processing' && item?.status === 'processing') return `${Math.round(item.fraction * 100)}%`
  return TILE_LABEL[kind]
}

export interface AttemptTileProps {
  attempt: AttemptView
  kind: TileKind
  /** 'small' = Library (84px, status only); 'large' = Dashboard (132px, with "Attempt n"). */
  size?: 'small' | 'large'
}

export function AttemptTile({ attempt, kind, size = 'small' }: AttemptTileProps) {
  const label = useTileLabel(attempt.id, kind)
  const large = size === 'large'
  const hatched = kind === 'low' || kind === 'none'
  return (
    <a
      className="attempt"
      href={href({ name: 'review', attemptId: attempt.id })}
      style={large ? { width: 132, flex: 'none' } : { minWidth: 0, width: 92, padding: 6, gap: 6 }}
      aria-label={`Attempt ${attempt.number}, ${kind === 'processing' ? `processing ${label}` : TILE_LABEL[kind]}`}
      title={attempt.clip_name ?? undefined}
    >
      <AttemptThumb attempt={attempt} className={hatched ? 'thumb v2-lib-hatch' : 'thumb'} style={{ height: large ? 60 : 40 }}>
        {!large && (
          <span className="v2-lib-n mono" aria-hidden="true">
            {attempt.number}
          </span>
        )}
      </AttemptThumb>
      {large && (
        <span className="t-small" style={{ fontWeight: 600 }}>
          Attempt {attempt.number}
        </span>
      )}
      <span className={`status st-${tileStatus(kind)}`} style={{ fontSize: 11 }}>
        <span className="dot" style={{ width: 8, height: 8 }} aria-hidden="true" />
        {label}
      </span>
    </a>
  )
}

// ---------- next focus ----------

export interface NextFocusCardProps {
  focus: NextFocus | null
  notes: AccountNotes
  /** Where "Open practice notes" goes when there are no notes yet. */
  emptyHref: string
  /** Phone layout: 16px padding, full-width button. */
  compact?: boolean
  /** Show the subject code after the label (accounts with subjects). */
  showSubject?: boolean
  /** Shown as "Next step" when there is no note's focus (see ./nextStep.ts). */
  step?: NextStep | null
  style?: CSSProperties
}

export function NextFocusCard({ focus, notes, emptyHref, compact, showSubject, step, style }: NextFocusCardProps) {
  const id = useId()
  const pad = compact ? 16 : 20
  const button = compact ? 'btn btn-secondary btn-lg btn-block' : 'btn btn-secondary btn-sm'
  const base = { padding: pad, display: 'flex', flexDirection: 'column' as const, gap: compact ? 10 : 12, minWidth: 0, ...style }

  // No note to take a focus from: a next step from the dancer's own clips instead.
  if (!focus && step && !notes.loading) {
    return (
      <section className="card" style={base} aria-labelledby={id}>
        <p className="t-label">Next step</p>
        <h2 className="t-h3" id={id}>
          {step.title}
        </h2>
        <p className="t-small muted">{step.body}</p>
        <a className={button} href={href(step.action.route)} style={compact ? undefined : { alignSelf: 'flex-start' }}>
          {step.action.label}
        </a>
      </section>
    )
  }

  if (!focus) {
    return (
      <section className="card" style={base} aria-labelledby={id}>
        <p className="t-label">Next focus</p>
        {notes.loading ? (
          <div aria-busy="true" aria-label="Loading practice notes" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <h2 className="v2-sr" id={id}>
              Next focus
            </h2>
            <Skeleton height={16} width="70%" />
            <Skeleton height={12} width="95%" />
            <Skeleton height={12} width="60%" />
          </div>
        ) : notes.error ? (
          <>
            <h2 className="t-h3" id={id}>
              {notes.error.message}
            </h2>
            <p className="t-small muted">{notes.error.recovery} Your clips and measurements are not affected.</p>
            <button className={button} type="button" onClick={notes.refetch} style={compact ? undefined : { alignSelf: 'flex-start' }}>
              Try again
            </button>
          </>
        ) : (
          <>
            <h2 className="t-h3" id={id}>
              No practice notes yet
            </h2>
            <p className="t-small muted">
              A next focus appears here once an attempt has practice notes. Notes are written from an attempt’s metrics only — never from
              the video.
            </p>
            <a className={button} href={emptyHref} style={compact ? undefined : { alignSelf: 'flex-start' }}>
              Open practice notes
            </a>
          </>
        )}
      </section>
    )
  }

  return (
    <section className="card" style={base} aria-labelledby={id}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <p className="t-label">Next focus{showSubject && focus.code ? ` · ${focus.code}` : ''}</p>
        <span className="tag">{focus.from}</span>
      </div>
      <h2 className="t-h3" id={id}>
        {focus.title}
      </h2>
      <p className="t-small muted">
        {focus.observation} Suggested: {focus.suggestion}
      </p>
      {focus.ribbon && (
        <div className="ribbon ribbon-sm" aria-hidden="true">
          {focus.ribbon.map((p, i) => (
            <div key={i} className={p.current ? 'phase current' : 'phase'} style={{ flex: p.flex }}>
              {p.label}
            </div>
          ))}
        </div>
      )}
      <a
        className={button}
        href={href({ name: 'notes', attemptId: focus.attemptId })}
        style={compact ? undefined : { alignSelf: 'flex-start' }}
      >
        Open practice notes
      </a>
      <p className="disclaimer">
        <Icon name="info" />
        AI-written from measurements only. Not medical advice.
      </p>
    </section>
  )
}

// ---------- trend ----------

const MONO = 'Geist Mono, monospace'
const SANS = 'Geist, sans-serif'

function TrendChart({ trend, metric }: { trend: Trend; metric: MetricKey }) {
  const { points, max } = trend
  const layout = layoutSeries(
    points.map((p) => p.median),
    max,
    { left: 40, right: 260, top: 20, bottom: 90 },
  )
  const unit = METRICS[metric].unitShort
  return (
    <svg viewBox="0 0 300 110" role="img" aria-label={trend.aria} style={{ width: '100%', height: 'auto' }}>
      <line x1="0" y1="90" x2="300" y2="90" stroke="var(--line)" />
      <line x1="0" y1="20" x2="300" y2="20" stroke="var(--line)" strokeDasharray="2 4" />
      <text x="0" y="14" fontSize="11" fill="var(--text-2)" fontFamily={MONO}>
        {max === null ? '—' : `${Number((max * METRICS[metric].scale).toPrecision(6))}${unit}`}
      </text>
      <text x="0" y="104" fontSize="11" fill="var(--text-2)" fontFamily={MONO}>
        0{unit}
      </text>
      {layout.lines.map((pts) => (
        <polyline key={pts} points={pts} fill="none" stroke="var(--series)" strokeWidth="2" />
      ))}
      {layout.dots.map((d) => {
        const p = points[d.index]
        if (d.y === null) {
          // No value: a dashed guide and a dash, so the gap is visible as a gap.
          return (
            <g key={p.sessionId}>
              <line x1={d.x} y1="28" x2={d.x} y2="90" stroke="var(--line-strong)" strokeDasharray="2 4" />
              <text x={d.x} y="62" fontSize="13" textAnchor="middle" fill="var(--text-3)" fontFamily={SANS}>
                —
              </text>
            </g>
          )
        }
        return (
          <g key={p.sessionId}>
            {p.partial ? (
              <circle cx={d.x} cy={d.y} r="4.5" fill="var(--surface)" stroke="var(--series)" strokeWidth="2" strokeDasharray="2 2" />
            ) : (
              <circle cx={d.x} cy={d.y} r="4" fill="var(--series)" />
            )}
            <text x={d.x} y={d.y - 10} fontSize="11" textAnchor="middle" fill={p.partial ? 'var(--text-2)' : 'var(--text)'} fontFamily={SANS}>
              {p.text}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

/** Fewer than two sessions with a value: the value large, what it is, and the hint (no one-dot chart). */
function SingleValue({ trend, metric }: { trend: Trend; metric: MetricKey }) {
  const point = [...trend.points].reverse().find((p) => p.median !== null)
  const unit = METRICS[metric].unitShort
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span className="metric-value" style={{ fontSize: 32, lineHeight: '40px', color: point ? undefined : 'var(--text-3)' }}>
        {point ? point.text.slice(0, point.text.length - unit.length) : '—'}
        {point && unit.trim() && <span className="metric-unit">{unit.trim()}</span>}
      </span>
      {point && <span className="t-caption">Median of {point.label}</span>}
      <span className="t-small muted">{firstSentence(METRICS[metric].description)}</span>
    </div>
  )
}

function useTrend(focus: Focus, wanted: MetricKey | null) {
  const options = metricsFor(focus.movement)
  const metric = wanted && options.includes(wanted) ? wanted : options[0]
  const trend = useMemo(() => buildTrend(focus, metric), [focus, metric])
  return { options, metric, trend }
}

export interface TrendCardProps {
  focus: Focus
  showSubject?: boolean
}

/** Desktop: metric picker, chart of session medians, the neutral sentence. */
export function TrendCard({ focus, showSubject }: TrendCardProps) {
  const selectId = useId()
  const [wanted, setWanted] = useState<MetricKey | null>(null)
  const { options, metric, trend } = useTrend(focus, wanted)
  const many = trend.points.length > 3
  const single = hasSingleValue(trend)
  return (
    <section className="card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }} aria-label="Trend">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <p className="t-label">Trend{showSubject && focus.code ? ` · ${focus.code}` : ''}</p>
        <label htmlFor={selectId} className="v2-sr">
          Metric
        </label>
        <select
          id={selectId}
          className="input input-sm"
          style={{ width: 'auto', height: 32, maxWidth: '100%' }}
          value={metric}
          onChange={(e) => setWanted(e.target.value as MetricKey)}
        >
          {options.map((k) => (
            <option key={k} value={k}>
              {METRICS[k].label}
            </option>
          ))}
        </select>
      </div>
      {single ? (
        <SingleValue trend={trend} metric={metric} />
      ) : (
        <>
          <TrendChart trend={trend} metric={metric} />
          <div style={{ display: 'flex', justifyContent: trend.points.length === 1 ? 'center' : 'space-between', gap: 8 }} className="t-caption">
            {trend.points.map((p) => (
              <span key={p.sessionId}>{many ? `${p.number}${p.partial ? ' · partial' : ''}` : p.label}</span>
            ))}
          </div>
        </>
      )}
      <p className="t-small muted">
        {trendLine(trend)}
        {trend.notes.length > 0 && ` ${trend.notes.join(' ')}`}
      </p>
      <TrendReason trend={trend} metric={metric} />
    </section>
  )
}

/** Why the latest session has no value: a slim row when the clip had nothing to measure (no plié), else the hatched box. */
function TrendReason({ trend, metric }: { trend: Trend; metric: MetricKey }) {
  if (!trend.reason) return null
  if (isCompactGap(trend.reason)) return <CompactGap name={METRICS[metric].label} reason={trend.reason} />
  return <p className="reason hatch">{trend.reason} Not shown as 0.</p>
}

/** The change sentence, or the one-session hint when exactly one session has a value. */
function trendLine(trend: Trend): string {
  return hasSingleValue(trend) && trend.series.sessions.some((s) => s.median !== null) ? ONE_SESSION_HINT : trend.sentence
}

/** Phone: latest median, a sparkline and the sentence (LibraryMobile.dc.html). */
export function TrendCardCompact({ focus }: TrendCardProps) {
  const { metric, trend } = useTrend(focus, null)
  const latest = trend.points[trend.points.length - 1]
  const layout = layoutSeries(
    trend.points.map((p) => p.median),
    trend.max,
    { left: 10, right: 150, top: 8, bottom: 48 },
  )
  const unit = METRICS[metric].unitShort
  const has = latest && latest.median !== null
  return (
    <section className="card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }} aria-label="Trend">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
        <p className="t-label">{METRICS[metric].label}</p>
        <span className="t-caption">session medians</span>
      </div>
      {hasSingleValue(trend) ? (
        <SingleValue trend={trend} metric={metric} />
      ) : (
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16 }}>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span className="metric-value" style={{ fontSize: 26, color: has ? undefined : 'var(--text-3)' }}>
            {has ? latest.text.slice(0, latest.text.length - unit.length) : '—'}
            {has && unit.trim() && <span className="metric-unit">{unit.trim()}</span>}
          </span>
          <span className="t-caption">{latest ? latest.label : 'No sessions'}</span>
        </div>
        <svg viewBox="0 0 160 56" role="img" aria-label={trend.aria} style={{ flex: 1, height: 56, minWidth: 0 }}>
          <line x1="0" y1="48" x2="160" y2="48" stroke="var(--line)" />
          {layout.lines.map((pts) => (
            <polyline key={pts} points={pts} fill="none" stroke="var(--series)" strokeWidth="2" />
          ))}
          {layout.dots.map((d) => {
            const p = trend.points[d.index]
            if (d.y === null) return <line key={p.sessionId} x1={d.x} y1="12" x2={d.x} y2="48" stroke="var(--line-strong)" strokeDasharray="2 4" />
            return p.partial ? (
              <circle key={p.sessionId} cx={d.x} cy={d.y} r="4" fill="var(--surface)" stroke="var(--series)" strokeWidth="2" strokeDasharray="2 2" />
            ) : (
              <circle key={p.sessionId} cx={d.x} cy={d.y} r="3.5" fill="var(--series)" />
            )
          })}
        </svg>
      </div>
      )}
      <p className="t-small muted">
        {trendLine(trend)}
        {trend.notes.length > 0 && ` ${trend.notes.join(' ')}`}
      </p>
      <TrendReason trend={trend} metric={metric} />
    </section>
  )
}
