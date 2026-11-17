// One small multiple of the Progress screen, drawn by hand like Progress.dc.html:
// attempts as dots, low-confidence values hollow and dashed, missing values as a cross
// (never a point at 0), the session median as a tick, and a thin line joining the
// medians of neighbouring sessions. One neutral colour plus the accent; no hue carries
// meaning.

import { CHART, type MetricPanel, type SessionColumn } from './model'

export interface ProgressChartProps {
  panel: MetricPanel
  sessions: readonly SessionColumn[]
}

const MONO = 'Geist Mono, ui-monospace, monospace'

export function ProgressChart({ panel, sessions }: ProgressChartProps) {
  const g = panel.geometry
  // With many sessions only some labels fit under the chart; the table has all of them.
  const every = Math.max(1, Math.ceil(sessions.length / 6))
  return (
    <>
      <svg
        viewBox={`0 0 ${CHART.width} ${CHART.height}`}
        role="img"
        aria-label={panel.aria}
        style={{ width: '100%', height: 'auto', overflow: 'visible' }}
      >
        <line x1={CHART.left} y1={CHART.top} x2={CHART.right} y2={CHART.top} stroke="var(--line)" strokeDasharray="2 4" />
        <line x1={CHART.left} y1={CHART.bottom} x2={CHART.right} y2={CHART.bottom} stroke="var(--line)" />
        {panel.maxLabel !== null && (
          <text x="0" y={CHART.top + 4} fontSize="11" fill="var(--text-2)" fontFamily={MONO}>
            {panel.maxLabel}
          </text>
        )}
        {panel.minLabel !== null && (
          <text x="0" y={CHART.bottom + 4} fontSize="11" fill="var(--text-2)" fontFamily={MONO}>
            {panel.minLabel}
          </text>
        )}
        {g.medianPaths.map((d) => (
          <path key={d} d={d} fill="none" stroke="var(--accent)" strokeWidth="1.5" opacity=".7" />
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
                stroke="var(--accent)"
                strokeWidth="3"
                strokeLinecap={c.partial ? 'butt' : 'round'}
                // A session that is only partly processed has a provisional median.
                strokeDasharray={c.partial ? '7 4' : undefined}
              />
            ),
        )}
        {g.dots.map((d) =>
          d.low ? (
            <circle key={d.attemptId} cx={d.x} cy={d.y} r="4.5" fill="var(--surface)" stroke="var(--text-3)" strokeWidth="1.25" strokeDasharray="2 2" />
          ) : (
            <circle key={d.attemptId} cx={d.x} cy={d.y} r="4" fill="var(--text-2)" />
          ),
        )}
        {g.gaps.map((m) => (
          <path
            key={m.attemptId}
            d={`M${m.x - 4} ${m.y - 4}l8 8M${m.x + 4} ${m.y - 4}l-8 8`}
            fill="none"
            stroke="var(--text-3)"
            strokeWidth="1.5"
          />
        ))}
      </svg>
      <div style={{ display: 'flex', paddingLeft: `${(CHART.left / CHART.width) * 100}%` }} className="t-caption" aria-hidden="true">
        {/* Session name, then its short date: sessions of one day share the date. */}
        {sessions.map((s, i) => (
          <span key={s.sessionId} style={{ flex: 1, textAlign: 'center', minWidth: 0 }}>
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
        ))}
      </div>
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
        Low confidence
      </span>
      <span style={item}>
        <svg width="12" height="12" aria-hidden="true">
          <path d="M2 2l8 8M10 2l-8 8" stroke="var(--text-3)" strokeWidth="1.5" />
        </svg>
        Not measurable
      </span>
      <span style={item}>
        <svg width="20" height="12" aria-hidden="true">
          <path d="M0 6h20" stroke="var(--accent)" strokeWidth="2" />
        </svg>
        Session median
      </span>
    </>
  )
}
