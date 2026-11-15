// Metric traces synced to the playhead. Each trace shows only the phases where
// its metric is defined; missing tracking is a gap, low confidence is hatched.

import { memo, useMemo, useRef, useState, useSyncExternalStore, type PointerEvent } from 'react'
import { CartesianGrid, Line, LineChart, ReferenceArea, ReferenceLine, XAxis, YAxis } from 'recharts'
import type { Attempt, Marker, MetricDefinition, MetricSample } from '../types'
import { useStudio } from '../state/studio'
import { clock, useClockTime } from '../state/clock'
import { useChartColors, type ChartColors } from '../state/theme'
import { mapTime, phaseAt } from '../lib/attempts'
import { appliesIn, qualitySpans, sampleAt, type QualitySpan } from '../lib/series'
import { formatValue } from '../lib/format'
import { useAttemptAtPlayhead, useElementWidth } from '../lib/hooks'
import { MetricIcon } from './MetricIcon'

const MARGIN = { top: 6, right: 10, bottom: 6, left: 0 }
const Y_W = 38

interface Row { t: number; a: number | null; b: number | null }

function yTicks({ domain: [lo, hi] }: MetricDefinition): number[] {
  return lo < 0 ? [lo, 0, hi] : [lo, Math.round((lo + hi) / 2), hi]
}

function buildRows(series: MetricSample[], win: Attempt, metric: MetricDefinition, fps: number, other: Attempt | null): Row[] {
  const rows: Row[] = []
  for (let i = Math.round(win.start * fps); i <= Math.round(win.end * fps); i++) {
    const t = i / fps
    const a = appliesIn(metric, phaseAt(win, t)?.id) ? sampleAt(series, t, fps).value : null
    let b: number | null = null
    if (other) {
      const tb = mapTime(t, win, other)
      b = appliesIn(metric, phaseAt(other, tb)?.id) ? sampleAt(series, tb, fps).value : null
    }
    rows.push({ t, a, b })
  }
  return rows
}

interface ChartProps {
  rows: Row[]
  metric: MetricDefinition
  win: Attempt
  spans: QualitySpan[]
  width: number
  height: number
  colors: ChartColors
  compare: boolean
  focus: boolean
}

const MetricChart = memo(function MetricChart({ rows, metric, win, spans, width, height, colors, compare, focus }: ChartProps) {
  if (width <= 0) return <div style={{ height }} />
  return (
    <LineChart width={width} height={height} data={rows} margin={MARGIN}>
      <CartesianGrid vertical={false} stroke={colors.grid} />
      {win.phases.map((p, i) => (i % 2 === 0 ? <ReferenceArea key={p.id} x1={p.start} x2={p.end} fill={colors.band} fillOpacity={1} ifOverflow="hidden" /> : null))}
      {spans.map((s) => (
        <ReferenceArea key={`${s.kind}${s.from}`} x1={s.from} x2={s.to} fill={s.kind === 'missing' ? 'url(#hatch-missing)' : 'url(#hatch-low)'} fillOpacity={1} ifOverflow="hidden" />
      ))}
      <XAxis type="number" dataKey="t" domain={[win.start, win.end]} hide allowDataOverflow />
      <YAxis domain={metric.domain} ticks={yTicks(metric)} interval={0} width={Y_W} axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: colors.muted }} allowDataOverflow />
      {metric.domain[0] < 0 && <ReferenceLine y={0} stroke={colors.muted} strokeDasharray="3 3" />}
      <Line dataKey="a" stroke={compare ? colors.a : focus ? colors.accent : colors.ink} strokeWidth={focus ? 2.4 : 1.8} dot={false} activeDot={false} isAnimationActive={false} connectNulls={false} />
      {compare && <Line dataKey="b" stroke={colors.b} strokeWidth={focus ? 2.4 : 1.8} dot={false} activeDot={false} isAnimationActive={false} connectNulls={false} />}
    </LineChart>
  )
})

function Playhead({ win }: { win: Attempt }) {
  const t = useClockTime()
  if (t < win.start || t > win.end) return null
  return <div className="playhead" style={{ left: `${((t - win.start) / (win.end - win.start)) * 100}%` }} />
}

function Readout({ metric, win, other }: { metric: MetricDefinition; win: Attempt; other: Attempt | null }) {
  const { results } = useStudio()
  const { fps } = results.session
  const text = useSyncExternalStore(clock.subscribe, () => {
    const t = clock.get().time
    const phase = phaseAt(win, t)
    if (!appliesIn(metric, phase?.id)) return phase ? `not measured in ${phase.label}` : 'outside the attempt'
    const s = sampleAt(results.series[metric.id], t, fps)
    const a = s.value === null ? 'no tracking' : formatValue(s.value, metric)
    if (!other) return a
    const sb = sampleAt(results.series[metric.id], mapTime(t, win, other), fps)
    return `A ${a} · B ${formatValue(sb.value, metric)}`
  })
  return <div className="readout">{text}</div>
}

function Track({ metric, win, other, focus, markers }: { metric: MetricDefinition; win: Attempt; other: Attempt | null; focus: boolean; markers: Marker[] }) {
  const { results, dispatch } = useStudio()
  const colors = useChartColors()
  const wrapRef = useRef<HTMLDivElement>(null)
  const width = useElementWidth(wrapRef)
  const [info, setInfo] = useState(false)
  const { fps } = results.session
  const series = results.series[metric.id]
  const rows = useMemo(() => buildRows(series, win, metric, fps, other), [series, win, metric, fps, other])
  const spans = useMemo(() => qualitySpans(series, win.start, win.end, fps), [series, win, fps])
  const pressed = useRef(false)

  const seekFrom = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    clock.seek(win.start + ((e.clientX - r.left) / r.width) * (win.end - win.start))
  }

  return (
    <div className={`track ${focus ? 'track-focus' : ''}`}>
      <div className="track-head">
        <button className="track-name" onClick={() => dispatch({ type: 'focusMetric', metricId: metric.id })} title="Make this the focus measurement">
          <MetricIcon id={metric.id} />
          <span>
            <b>{metric.name}</b>
            <small>{metric.question}</small>
          </span>
        </button>
        <Readout metric={metric} win={win} other={other} />
        <button className={`info-btn ${info ? 'on' : ''}`} onClick={() => setInfo(!info)} aria-label={`How ${metric.name} is measured`} title="How is this measured?">
          i
        </button>
      </div>
      {info && (
        <p className="track-info">
          {metric.reading} Measured during {metric.phases.length === 4 ? 'all phases' : metric.phases.join(', ')}. Definition v{metric.version}.
        </p>
      )}
      <div className="chart-wrap" ref={wrapRef}>
        <MetricChart rows={rows} metric={metric} win={win} spans={spans} width={width} height={focus ? 128 : 72} colors={colors} compare={!!other} focus={focus} />
        <div
          className="chart-overlay"
          style={{ left: MARGIN.left + Y_W, right: MARGIN.right, top: MARGIN.top, bottom: MARGIN.bottom }}
          onPointerDown={(e) => {
            pressed.current = true
            seekFrom(e)
            e.currentTarget.setPointerCapture(e.pointerId)
          }}
          onPointerMove={(e) => pressed.current && seekFrom(e)}
          onPointerUp={() => (pressed.current = false)}
        >
          {focus &&
            markers
              .filter((m) => m.t >= win.start && m.t <= win.end)
              .map((m) => <span key={m.id} className="chart-marker" style={{ left: `${((m.t - win.start) / (win.end - win.start)) * 100}%` }} title={m.text || 'Moment'} />)}
          <Playhead win={win} />
        </div>
      </div>
    </div>
  )
}

function PhaseRuler({ win }: { win: Attempt }) {
  const span = win.end - win.start
  return (
    <div className="ruler" style={{ marginLeft: MARGIN.left + Y_W, marginRight: MARGIN.right }}>
      {win.phases.map((p) => (
        <span key={p.id} className="ruler-phase" style={{ left: `${((p.start - win.start) / span) * 100}%`, width: `${((p.end - p.start) / span) * 100}%` }}>
          {p.label}
        </span>
      ))}
    </div>
  )
}

export function MetricPanel() {
  const { state, orderedMetrics, attemptById } = useStudio()
  const current = useAttemptAtPlayhead(state.attempts)
  const comparing = state.mode === 'compare'
  const win = comparing ? attemptById(state.compare.a) : current
  const other = comparing ? attemptById(state.compare.b) : null

  return (
    <div className="panel metric-panel">
      <div className="panel-head">
        <div>
          <div className="panel-title">Measurements · attempt {win.index}</div>
          <div className="panel-sub">Click or drag a trace to move the video. Gaps mean no pose was tracked.</div>
        </div>
        {comparing && other && (
          <div className="legend">
            <span><i className="swatch swatch-a" /> A · attempt {win.index}</span>
            <span><i className="swatch swatch-b" /> B · attempt {other.index}, time-matched by phase</span>
          </div>
        )}
      </div>
      <div className="tracks">
        <PhaseRuler win={win} />
        {orderedMetrics.map((m, i) => (
          <Track key={m.id} metric={m} win={win} other={other} focus={i === 0} markers={state.markers} />
        ))}
        <div className="legend legend-quality">
          <span><i className="swatch swatch-low" /> low tracking confidence</span>
          <span><i className="swatch swatch-missing" /> no pose tracked</span>
        </div>
      </div>
    </div>
  )
}
