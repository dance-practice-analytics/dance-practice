// Strip plot: one column per session, one dot per attempt, a tick at the median.
// Shows spread and change over time, never a verdict.

import { useRef, useState, type CSSProperties } from 'react'
import type { MetricDefinition } from '../types'
import { formatValue } from '../lib/format'
import { useElementWidth } from '../lib/hooks'
import { day, RELEVE_DOMAIN, type Column, type Point } from '../lib/acrossSessions'

interface Props {
  columns: Column[]
  metric: MetricDefinition | null
  height?: number
  compact?: boolean
  label: string
}

export function formatMeasure(v: number, metric: MetricDefinition | null, unit = true) {
  return metric ? formatValue(v, metric, unit) : `${v.toFixed(1)}${unit ? ' s' : ''}`
}

export function SessionStrip({ columns, metric, height = 200, compact = false, label }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const width = useElementWidth(wrapRef)
  const [hover, setHover] = useState<{ x: number; y: number; p: Point; c: Column } | null>(null)
  const domain = metric ? metric.domain : RELEVE_DOMAIN
  const H = height
  const PAD = { l: compact ? 34 : 44, r: 8, t: 10, b: compact ? 22 : 34 }
  const innerW = Math.max(0, width - PAD.l - PAD.r)
  const colW = columns.length ? innerW / columns.length : 0
  const y = (v: number) => PAD.t + (1 - (Math.min(domain[1], Math.max(domain[0], v)) - domain[0]) / (domain[1] - domain[0])) * (H - PAD.t - PAD.b)
  const ticks = domain[0] < 0 ? [domain[0], 0, domain[1]] : [domain[0], (domain[0] + domain[1]) / 2, domain[1]]
  const medians = columns.map((c, i) => (c.median === null ? null : ([PAD.l + colW * (i + 0.5), y(c.median)] as const)))

  return (
    <div className="strip" ref={wrapRef} onPointerLeave={() => setHover(null)}>
      {width > 0 && (
        <svg width={width} height={H} role="img" aria-label={`${label}. Strip plot of attempts per session; the table view lists the values.`}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.l} x2={width - PAD.r} y1={y(t)} y2={y(t)} className={t === 0 && domain[0] < 0 ? 'ax-zero' : 'ax-grid'} />
              <text x={PAD.l - 8} y={y(t)} className="ax-label" textAnchor="end" dominantBaseline="middle">{formatMeasure(t, metric, false).replace(/\.0$/, '')}</text>
            </g>
          ))}
          {/* Median path joins only neighbouring comparable sessions, so a side-view session breaks it. */}
          {medians.map((m, i) => {
            const n = medians[i + 1]
            return m && n ? <line key={i} style={{ '--i': i } as CSSProperties} x1={m[0]} y1={m[1]} x2={n[0]} y2={n[1]} className="strip-path" /> : null
          })}
          {columns.map((c, i) => {
            const cx = PAD.l + colW * (i + 0.5)
            return (
              <g key={c.s.id} style={{ '--i': i } as CSSProperties}>
                {!c.comparable && <rect x={cx - colW / 2 + 3} width={Math.max(0, colW - 6)} y={PAD.t} height={H - PAD.t - PAD.b} fill="url(#hatch-missing)" rx="6" opacity="0.55" />}
                <text x={cx} y={H - (compact ? 6 : 16)} className="ax-label" textAnchor="middle">{day(c.s.recordedAt)}</text>
                {!compact && !c.comparable && <text x={cx} y={H - 3} className="ax-label ax-note" textAnchor="middle">{c.s.conditions.view} view</text>}
                {c.comparable && (
                  <>
                    {c.median !== null && <line x1={cx - Math.min(18, colW / 3)} x2={cx + Math.min(18, colW / 3)} y1={y(c.median)} y2={y(c.median)} className="strip-median" />}
                    {c.points.map((p, k) => {
                      const px = cx + (k - (c.points.length - 1) / 2) * Math.min(9, colW / 9)
                      if (p.value === null) return null
                      const on = hover?.p === p
                      return (
                        <g key={k} style={{ '--k': k } as CSSProperties} onPointerEnter={() => setHover({ x: px, y: y(p.value!), p, c })}>
                          <circle cx={px} cy={y(p.value)} r="11" fill="transparent" />
                          <circle cx={px} cy={y(p.value)} r={on ? 5.5 : compact ? 3.5 : 4} className="strip-dot" />
                        </g>
                      )
                    })}
                  </>
                )}
              </g>
            )
          })}
        </svg>
      )}
      {hover && hover.p.value !== null && (
        <div className="tooltip" style={{ left: hover.x, top: hover.y }}>
          <b>{formatMeasure(hover.p.value, metric)}</b>
          <span>{day(hover.c.s.recordedAt)} · attempt {hover.p.attempt}</span>
        </div>
      )}
    </div>
  )
}

export function StripTable({ columns, metric }: { columns: Column[]; metric: MetricDefinition | null }) {
  const n = Math.max(0, ...columns.map((c) => c.points.length))
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr><th>Session</th><th>View</th><th>Median</th>{Array.from({ length: n }, (_, i) => <th key={i}>Attempt {i + 1}</th>)}</tr>
        </thead>
        <tbody>
          {columns.map((c) => (
            <tr key={c.s.id}>
              <td>{day(c.s.recordedAt)}</td>
              <td>{c.s.conditions.view}</td>
              <td>{!c.comparable ? <span className="na">not compared</span> : c.median === null ? <span className="na">unavailable</span> : formatMeasure(c.median, metric)}</td>
              {c.points.map((p) => <td key={p.attempt}>{!c.comparable ? '' : p.value === null ? <span className="na">{p.reason}</span> : formatMeasure(p.value, metric)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
