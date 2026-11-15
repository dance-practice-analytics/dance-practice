// Timeline pieces shared by Review and Compare (Review.dc.html › Phases card,
// Main.dc.html › ribbon / track / band-low / playhead). Each piece subscribes to the
// clock only for what it shows: the ribbon for the current phase, a readout for the
// frame, the playhead for its position.

import { memo, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import type { PhaseSpan } from '../../../metrics/types'
import type { PoseSeries } from '../../../pose/types'
import { formatNumber, formatTimecode, frameAt, PHASE_LABELS, type Phase } from '../../format'
import type { Clock } from './clock'
import { polylinePoints, spanStyle, trunkAt, visibilityAt, type Band, type TraceSegment } from './timeline'
import { useClockValue } from './useClock'

const SHORT_PHASE: Record<Phase, string> = { prep: 'Prep', rise: 'Rise', hold: 'Hold', turn: 'Turn', finish: 'Fin.', recovery: 'Rec.' }

// ---------- playhead ----------

export function Playhead({ clock, duration }: { clock: Clock; duration: number }) {
  const pct = useClockValue(clock, (s) => (duration > 0 ? Math.min(100, Math.max(0, (s.time / duration) * 100)) : 0))
  return <div className="playhead" style={{ left: `${pct}%` }} />
}

// ---------- phase ribbon ----------

export interface PhaseRibbonProps {
  clock: Clock
  phases: readonly PhaseSpan[]
  duration: number
  /** Short names, no durations (phone, Compare rows). */
  compact?: boolean
  /** Smallest share of the ribbon a phase needs to carry its (short) name; smaller ones are bare. */
  minLabelShare?: number
  small?: boolean
  /** Places a phase on the ribbon's own axis (Compare draws B on A's time). */
  mapT?: (t: number) => number
  /** Where a click on phase `p` sends the clock; default: its start. */
  seekTo?: (p: PhaseSpan) => number
  /** Shown instead of phases when there are none. */
  emptyText?: string
  label?: string
  style?: CSSProperties
}

/** `.ribbon`: the phases in their real positions; the one under the playhead is marked. Click to jump. */
export function PhaseRibbon(props: PhaseRibbonProps) {
  const { clock, phases, duration, compact, small, mapT, seekTo, emptyText = 'No phases found in this clip', label = 'Phases', style } = props
  const minLabelShare = props.minLabelShare ?? (compact ? 0.04 : 0.05)
  const x = mapT ?? ((t: number) => t)
  const spans = phases.map((p) => ({ p, start: x(p.start), end: x(p.end) }))
  const current = useClockValue(clock, (s) => spans.findIndex((q) => s.time >= q.start && s.time < q.end))
  const cls = small ? 'ribbon ribbon-sm' : 'ribbon'

  if (spans.length === 0 || !(duration > 0)) {
    return (
      <div className={cls} style={style}>
        <div className="phase unread" style={{ flex: 1 }}>
          {emptyText}
        </div>
      </div>
    )
  }

  const items: ReactNode[] = []
  let cursor = 0
  const spacer = (width: number, key: string) =>
    width > 1e-3 && items.push(<span key={key} aria-hidden="true" style={{ flex: `${width} 1 0`, minWidth: 0 }} />)
  spans.forEach(({ p, start, end }, i) => {
    // Time outside every phase stays empty on the ribbon.
    spacer(start - cursor, `gap-${i}`)
    const on = i === current
    const length = p.end - p.start
    // A phase too narrow for its name is a bare block (its title and label still say what it is).
    const share = (end - start) / duration
    const full = !compact && share >= 0.14
    const text = full ? PHASE_LABELS[p.phase] : share >= minLabelShare ? SHORT_PHASE[p.phase] : null
    items.push(
      <button
        key={`${p.phase}-${i}`}
        type="button"
        className={on ? 'phase current v2-rev-phase' : 'phase v2-rev-phase'}
        aria-current={on ? 'step' : undefined}
        aria-label={`${PHASE_LABELS[p.phase]} phase, ${formatNumber(length, 1)} seconds`}
        title={`${PHASE_LABELS[p.phase]} · ${formatTimecode(p.start)}–${formatTimecode(p.end)}`}
        onClick={() => clock.seek(seekTo ? seekTo(p) : p.start)}
        style={{ flex: `${Math.max(end - start, 1e-3)} 1 0`, justifyContent: full ? undefined : 'center', padding: full ? undefined : text ? '0 4px' : 0 }}
      >
        {text}
        {full && <span className="mono">{formatNumber(length, 1)}s</span>}
      </button>,
    )
    cursor = Math.max(cursor, end)
  })
  spacer(duration - cursor, 'gap-end')

  return (
    <div className={cls} role="group" aria-label={label} style={style}>
      {items}
    </div>
  )
}

// ---------- scrubbing ----------

function useScrub(clock: Clock, duration: number) {
  const seekFrom = (e: PointerEvent<HTMLElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    if (rect.width > 0) clock.seek(((e.clientX - rect.left) / rect.width) * duration)
  }
  return {
    onPointerDown(e: PointerEvent<HTMLElement>) {
      if (e.button !== 0) return
      e.currentTarget.setPointerCapture(e.pointerId)
      // Scrubbing is frame by frame: playback stops where the pointer lands.
      clock.pause()
      seekFrom(e)
    },
    onPointerMove(e: PointerEvent<HTMLElement>) {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) seekFrom(e)
    },
  }
}

export interface ScrubTrackProps {
  clock: Clock
  duration: number
  /** Accessible name of the slider, e.g. 'Playhead'. */
  label: string
  height?: number
  /** Static layers (bands, traces). Pass a stable element so it isn't re-rendered with the playhead. */
  children?: ReactNode
  style?: CSSProperties
}

/**
 * The scrubber: a `.track` with slider semantics. Drag or click to move the playhead;
 * ← → move one frame, Shift+← → one second, Home / End the ends of the clip.
 */
export function ScrubTrack({ clock, duration, label, height = 40, children, style }: ScrubTrackProps) {
  const time = useClockValue(clock, (s) => s.time)
  const scrub = useScrub(clock, duration)
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const { fps } = clock.get()
    const second = Math.max(1, Math.round(fps || 1))
    const back = e.key === 'ArrowLeft' || e.key === 'ArrowDown'
    const forward = e.key === 'ArrowRight' || e.key === 'ArrowUp'
    if (back || forward) clock.step((back ? -1 : 1) * (e.shiftKey ? second : 1))
    else if (e.key === 'PageDown' || e.key === 'PageUp') clock.step(e.key === 'PageDown' ? -second : second)
    else if (e.key === 'Home') clock.seek(0)
    else if (e.key === 'End') clock.seek(duration)
    else return
    e.preventDefault()
    e.stopPropagation()
  }
  const pct = duration > 0 ? Math.min(100, Math.max(0, (time / duration) * 100)) : 0
  return (
    <div
      className="track v2-rev-scrub"
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-orientation="horizontal"
      aria-valuemin={0}
      aria-valuemax={Number(duration.toFixed(2))}
      aria-valuenow={Number(Math.min(time, duration).toFixed(2))}
      aria-valuetext={`${formatTimecode(Math.min(time, duration))} of ${formatTimecode(duration)}`}
      onKeyDown={onKeyDown}
      {...scrub}
      style={{ height, ...style }}
    >
      {children}
      <div className="playhead" style={{ left: `${pct}%` }} />
    </div>
  )
}

export interface TraceTrackProps {
  clock: Clock
  duration: number
  /** Text alternative: what the chart shows and where tracking is weak or missing. */
  ariaLabel: string
  height?: number
  children?: ReactNode
  style?: CSSProperties
}

/** A chart `.track` (role img) that also seeks on click or drag; keyboard users have the scrubber. */
export function TraceTrack({ clock, duration, ariaLabel, height = 52, children, style }: TraceTrackProps) {
  const scrub = useScrub(clock, duration)
  return (
    <div className="track v2-rev-chart" role="img" aria-label={ariaLabel} {...scrub} style={{ height, ...style }}>
      {children}
      <Playhead clock={clock} duration={duration} />
    </div>
  )
}

// ---------- static layers ----------

/** Hatched bands: no tracking (also tinted) and low confidence. Never drawn over, never filled in. */
export const BandLayer = memo(function BandLayer({ bands, duration, mapT }: { bands: readonly Band[]; duration: number; mapT?: (t: number) => number }) {
  const x = mapT ?? ((t: number) => t)
  return (
    <>
      {bands.map((b, i) => (
        <div
          key={i}
          className={b.kind === 'gap' ? 'band-low v2-rev-band v2-rev-gap' : 'band-low v2-rev-band'}
          title={`${b.kind === 'gap' ? 'No tracking' : 'Low confidence'} ${formatTimecode(b.start)}–${formatTimecode(b.end)}`}
          style={spanStyle(x(b.start), x(b.end), duration)}
        />
      ))}
    </>
  )
})

export interface TraceLayerProps {
  segments: readonly TraceSegment[]
  duration: number
  max: number
  height?: number
  /** Stroke of the well-tracked parts; weakly tracked parts are always thin, dashed and grey. */
  stroke?: string
  strokeWidth?: number
  /** Dash pattern of the well-tracked parts (Compare: A is dashed, B is solid). */
  dash?: string
  /** Dash pattern of the weakly tracked parts. */
  lowDash?: string
  mapT?: (t: number) => number
}

const VIEW_W = 1000

/** The trace as SVG polylines; a missing frame is a break in the line. */
export const TraceLayer = memo(function TraceLayer(props: TraceLayerProps) {
  const { segments, duration, max, height = 64, stroke = 'var(--text-2)', strokeWidth = 1.75, dash, lowDash = '3 4', mapT } = props
  return (
    <svg viewBox={`0 0 ${VIEW_W} ${height}`} preserveAspectRatio="none" aria-hidden="true">
      {segments.map((s, i) =>
        s.points.length < 2 ? null : s.kind === 'solid' ? (
          <polyline
            key={i}
            points={polylinePoints(s, duration, max, VIEW_W, height, mapT)}
            fill="none"
            stroke={stroke}
            strokeWidth={strokeWidth}
            strokeDasharray={dash}
            vectorEffect="non-scaling-stroke"
          />
        ) : (
          <polyline
            key={i}
            points={polylinePoints(s, duration, max, VIEW_W, height, mapT)}
            fill="none"
            stroke="var(--text-3)"
            strokeWidth={1.5}
            strokeDasharray={lowDash}
            vectorEffect="non-scaling-stroke"
          />
        ),
      )}
    </svg>
  )
})

export function TimeAxis({ duration }: { duration: number }) {
  return (
    <div className="mono subtle" aria-hidden="true" style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
      {[0, 0.25, 0.5, 0.75, 1].map((f) => (
        <span key={f}>{formatTimecode(duration * f)}</span>
      ))}
    </div>
  )
}

// ---------- readouts at the playhead ----------

const READ_STRONG: CSSProperties = { fontWeight: 600 }
const READ_WEAK: CSSProperties = { color: 'var(--text-3)' }

/** Trunk inclination of the frame under the playhead, computed from that frame's landmarks. */
export function TrunkReadout({ clock, series, toLocal }: { clock: Clock; series: PoseSeries; toLocal?: (t: number) => number }) {
  const frame = useClockValue(clock, (s) => frameAt(series, toLocal ? toLocal(s.time) : s.time))
  const r = frame ? trunkAt(frame) : null
  if (!r) {
    return (
      <span className="t-small num" style={READ_WEAK}>
        — · no tracking
      </span>
    )
  }
  return (
    <span className="t-small num" style={r.low ? READ_WEAK : READ_STRONG}>
      {formatNumber(r.v, 1)}°{r.low ? ' · low confidence' : ''}
    </span>
  )
}

/** Tracking of the frame under the playhead: mean visibility of the body joints, or the gap. */
export function TrackingReadout({ clock, series }: { clock: Clock; series: PoseSeries }) {
  const frame = useClockValue(clock, (s) => frameAt(series, s.time))
  const r = frame ? visibilityAt(frame) : null
  if (!r) {
    return (
      <span className="t-small num" style={READ_WEAK}>
        No tracking in this frame
      </span>
    )
  }
  return (
    <span className="t-small num" style={r.low ? READ_WEAK : READ_STRONG}>
      {formatNumber(r.v, 2)}
      {r.low ? ' · low confidence' : ''}
    </span>
  )
}
