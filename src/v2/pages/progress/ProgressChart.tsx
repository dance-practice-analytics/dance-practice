// One small multiple of the Progress screen, drawn by hand like Progress.dc.html:
// attempts as dots, values with low camera visibility hollow and dashed, missing values as a
// cross (never a point at 0), the session median as a tick, and a thin line joining the
// medians of neighbouring sessions. One neutral colour plus the series colour; no hue carries
// meaning.
//
// Mentor review, change 5: gridlines with decimal labels, an optional y axis fitted to the
// values, an attempts x axis (one slot per attempt, sessions separated), and a large version
// for the Expand dialog with attempt numbers. Every dot has a tooltip with its value.

import { useMemo } from 'react'
import { CHART, CHART_LARGE, chartGeometry, tickLabel, type ChartAxis, type ChartGeometry, type ChartOptions, type SessionColumn } from './model'
import type { ProgressSession } from '../../../insights'

export interface ProgressChartProps {
  panel: { geometry: ChartGeometry; aria: string; data: readonly ProgressSession[]; axis: ChartAxis }
  sessions: readonly SessionColumn[]
  options?: ChartOptions
  /** The enlarged chart of the Expand dialog. */
  large?: boolean
}

const MONO = 'Geist Mono, ui-monospace, monospace'

export function ProgressChart({ panel, sessions, options, large }: ProgressChartProps) {
  const dims = large ? CHART_LARGE : CHART
  const plain = !large && (options?.y ?? 'zero') === 'zero' && (options?.x ?? 'sessions') === 'sessions'
  const g = useMemo(() => (plain ? panel.geometry : chartGeometry(panel.data, options, dims)), [plain, panel.geometry, panel.data, options, dims])
  const names = new Map(sessions.map((s) => [s.sessionId, s.name]))
  const sessionOf = new Map(panel.data.flatMap((s) => s.points.map((p) => [p.attemptId, s.sessionId] as const)))
  const font = large ? 12 : 11
  const r = large ? 5 : 4
  // With many sessions only some labels fit under the chart; the table has all of them.
  const every = Math.max(1, Math.ceil(sessions.length / (large ? 10 : 6)))
  const attemptsAxis = g.x === 'attempts'
  const tip = (attemptId: string, label: string, text: string) => `${names.get(sessionOf.get(attemptId) ?? '') ?? ''} · ${label}: ${text}`

  return (
    <>
      <svg viewBox={`0 0 ${dims.width} ${dims.height}`} role="img" aria-label={panel.aria} style={{ width: '100%', height: 'auto', overflow: 'visible' }}>
        {g.ticks.map((t, i) => {
          const edge = i === 0 || i === g.ticks.length - 1
          const zero = t.v === 0 && g.min !== null && g.min < 0
          return (
            <g key={t.v}>
              <line
                x1={dims.left}
                y1={t.y}
                x2={dims.right}
                y2={t.y}
                stroke="var(--line)"
                strokeDasharray={i === 0 || zero ? undefined : edge ? '2 4' : '1 5'}
                opacity={edge || zero ? 1 : 0.8}
              />
              <text x="0" y={t.y + 4} fontSize={font} fill="var(--text-2)" fontFamily={MONO}>
                {g.step !== null ? tickLabel(panel.axis, t.v, g.step, i === g.ticks.length - 1) : ''}
              </text>
            </g>
          )
        })}
        {g.separators.map((x) => (
          <line key={`sep-${x}`} x1={x} x2={x} y1={dims.top} y2={dims.bottom} stroke="var(--line-strong, var(--line))" strokeDasharray="3 3" />
        ))}
        {g.medianPaths.map((d) => (
          <path key={d} d={d} fill="none" stroke="var(--series)" strokeWidth="1.5" opacity=".7" />
        ))}
        {g.columns.map(
          (c) =>
            c.tick && (
              <line
                key={c.sessionId}
                x1={c.tick.x1}
                x2={c.tick.x2}
                y1={c.tick.y}
                y2={c.tick.y}
                stroke="var(--series)"
                strokeWidth="3"
                strokeLinecap={c.partial ? 'butt' : 'round'}
                // A session that is only partly processed has a provisional median.
                strokeDasharray={c.partial ? '7 4' : undefined}
              />
            ),
        )}
        {g.dots.map((d) =>
          d.low ? (
            <circle key={d.attemptId} cx={d.x} cy={d.y} r={r + 0.5} fill="var(--surface)" stroke="var(--text-3)" strokeWidth="1.25" strokeDasharray="2 2">
              <title>{tip(d.attemptId, d.label, `${panel.axis.valueText(d.value)} · low camera visibility, not counted`)}</title>
            </circle>
          ) : (
            <circle key={d.attemptId} cx={d.x} cy={d.y} r={r} fill="var(--text-2)">
              <title>{tip(d.attemptId, d.label, panel.axis.valueText(d.value))}</title>
            </circle>
          ),
        )}
        {g.gaps.map((m) => (
          <path key={m.attemptId} d={`M${m.x - 4} ${m.y - 4}l8 8M${m.x + 4} ${m.y - 4}l-8 8`} fill="none" stroke="var(--text-3)" strokeWidth="1.5">
            <title>{tip(m.attemptId, m.label, 'no value')}</title>
          </path>
        ))}
        {large &&
          attemptsAxis &&
          [...g.dots, ...g.gaps].map((d) => (
            <text key={`n-${d.attemptId}`} x={d.x} y={dims.bottom + 16} fontSize={11} fill="var(--text-3)" fontFamily={MONO} textAnchor="middle">
              {d.order}
            </text>
          ))}
      </svg>
      <div style={{ display: 'flex', paddingLeft: `${(dims.left / dims.width) * 100}%` }} className="t-caption" aria-hidden="true">
        {/* Session name, then its short date: sessions of one day share the date. Width follows the session's share of the axis. */}
        {sessions.map((s, i) => {
          const c = g.columns[i]
          const share = c ? (c.x2 - c.x1) / (dims.right - dims.left) : 1 / sessions.length
          return (
            <span key={s.sessionId} style={{ flex: `${share} 1 0`, textAlign: 'center', minWidth: 0 }}>
              {(i % every === 0 || i === sessions.length - 1) && (
                <>
                  <span className="v2-clip" style={{ display: 'block' }}>
                    {s.name}
                  </span>
                  <span className="v2-clip subtle" style={{ display: 'block' }}>
                    {s.partial ? `${s.dateLabel} · partial` : s.dateLabel}
                  </span>
                </>
              )}
            </span>
          )
        })}
      </div>
      {large && attemptsAxis && <p className="t-caption">Numbers under the chart: attempts in order, oldest first. Dashed lines separate sessions.</p>}
    </>
  )
}

/** The four marks of the chart, as in the design's legend row. */
export function ProgressLegend({ compact }: { compact?: boolean }) {
  const item = { display: 'inline-flex', gap: compact ? 6 : 8, alignItems: 'center' } as const
  return (
    <>
      <span style={item}>
        <svg width="12" height="12" aria-hidden="true">
          <circle cx="6" cy="6" r="4.5" fill="var(--text-2)" />
        </svg>
        Attempt
      </span>
      <span style={item}>
        <svg width="12" height="12" aria-hidden="true">
          <circle cx="6" cy="6" r="4.5" fill="var(--surface)" stroke="var(--text-3)" strokeDasharray="2 2" />
        </svg>
        Low camera visibility
      </span>
      <span style={item}>
        <svg width="12" height="12" aria-hidden="true">
          <path d="M2 2l8 8M10 2l-8 8" stroke="var(--text-3)" strokeWidth="1.5" />
        </svg>
        Not measurable
      </span>
      <span style={item}>
        <svg width="20" height="12" aria-hidden="true">
          <path d="M0 6h20" stroke="var(--series)" strokeWidth="2" />
        </svg>
        Session median
      </span>
    </>
  )
}
