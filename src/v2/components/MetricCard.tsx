// `.metric` card (Main.dc.html › Metric cards, States.dc.html › is-none).
// A value with its unit, confidence badge and phase — or, when there is no value,
// a dash with the hatched reason. Never a score, never a colour judgement, never 0
// for something that wasn't measured.

import type { ReactNode } from 'react'
import { displayValue, formatNumber, NO_VALUE, PHASE_LABELS, type MetricKey, type MetricReading } from '../format'
import { Icon } from './Icon'
import { InfoDisclosure } from './InfoDisclosure'
import { MetricFigure } from './MetricFigure'
import { ConfBadge, type Confidence } from './primitives'
import { ValueUnit } from './ValueUnit'

export interface MetricCardProps {
  name: string
  /** Null = not available: shows '—' and `reason` (hatched). */
  value: number | null
  /** After the value, e.g. '° from vertical'. */
  unit?: string
  decimals?: number
  /** Omit to hide the badge. With a null value it is always shown as "No tracking". */
  confidence?: Confidence
  /** Phase tag(s), e.g. 'Hold'. */
  phase?: string
  /** Short note after the phase tag, e.g. 'mean of 102 frames', '0 = pelvis over ankle'. */
  meta?: ReactNode
  /** Neutral difference line, e.g. from `differenceText()`. */
  delta?: ReactNode
  /**
   * Why the value is missing (required in spirit when `value` is null) or why its
   * confidence is low. Rendered as the hatched `.reason`.
   */
  reason?: ReactNode
  /** "What does this mean?": a drawing of what is measured and one plain sentence. Not on a button card. */
  info?: { metric: MetricKey; text: string }
  /** Under the explanation: a link to ask Mika about this attempt (the chat route). */
  askHref?: string
  selected?: boolean
  /** Makes the card a button (e.g. to focus this metric on the timeline). */
  onSelect?(): void
}

export function MetricCard(props: MetricCardProps) {
  const { name, value, unit, decimals = 1, phase, meta, delta, reason, info, askHref, selected, onSelect } = props
  const none = value === null || !Number.isFinite(value)
  const confidence: Confidence | undefined = none ? 'none' : props.confidence
  const cls = ['metric', none ? 'is-none' : confidence === 'low' ? 'is-low' : '', selected ? 'is-selected' : '']
    .filter(Boolean)
    .join(' ')

  const body = (
    <>
      <div className="metric-top">
        <span className="metric-name">{name}</span>
        {confidence && <ConfBadge level={confidence} />}
      </div>
      <div className="metric-value">
        {none ? NO_VALUE : formatNumber(value, decimals)}
        {!none && unit && <ValueUnit unit={unit} />}
      </div>
      {(phase || meta) && (
        <div className="metric-meta">
          {phase && <span className="tag">{phase}</span>}
          {meta && <span>{meta}</span>}
        </div>
      )}
      {!none && delta && <p className="metric-delta">{delta}</p>}
      {(reason || none) && <p className="reason hatch">{reason ?? 'Not available for this attempt. Not shown as 0.'}</p>}
      {info && !onSelect && (
        <InfoDisclosure about={name}>
          <MetricFigure metric={info.metric} />
          <p className="t-small">{info.text}</p>
          {askHref && (
            <a className="v2-metric-info-ask" href={askHref}>
              <Icon name="mika" size={16} />
              Ask Mika about this
            </a>
          )}
        </InfoDisclosure>
      )}
    </>
  )

  if (!onSelect) return <div className={cls}>{body}</div>
  return (
    <button
      type="button"
      className={`${cls} v2-metric-btn`}
      aria-pressed={!!selected}
      onClick={onSelect}
    >
      {body}
    </button>
  )
}

/** Props for a MetricCard from `readMetric()` / `readMetrics()` in format.ts. */
export function metricCardProps(reading: MetricReading): MetricCardProps {
  return {
    name: reading.def.label,
    // Display units: a ratio of leg length shows as a percent.
    value: reading.value === null ? null : displayValue(reading.key, reading.value),
    unit: reading.def.unit,
    decimals: reading.def.displayDecimals,
    confidence: reading.confidence,
    phase: reading.phases.map((p) => PHASE_LABELS[p]).join(' + ') || undefined,
    reason: reading.reason ?? (reading.notes.length > 0 ? reading.notes.join(' ') : undefined),
    info: { metric: reading.key, text: reading.def.description },
  }
}
