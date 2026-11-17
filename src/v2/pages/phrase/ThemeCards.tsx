// Theme cards of a phrase attempt (Review). Same `.metric` card as the relevé measures:
// value + unit, confidence badge in words, a hatched reason when there is no value, and
// "What does this mean?". The dancer's focus themes come first; "Focus" pins up to three.

import type { ReactNode } from 'react'
import type { CameraView } from '../../../data/schema'
import type { PhraseResult } from '../../../metrics/phrase'
import { CompactGap, ConfBadge, Icon, InfoDisclosure } from '../../components'
import { NO_VALUE } from '../../format'
import { COMPACT_REASONS, COMPACT_TEXT, orderThemes, readTheme, themeDifference, type ThemeKey, type ThemeReading } from './model'
import './phrase.css'

export interface ThemeCardsProps {
  phrase: PhraseResult | null
  view: CameraView | null
  focus: readonly ThemeKey[]
  /** Omit to hide the focus checkboxes. */
  onToggleFocus?(key: ThemeKey): void
  focusBusy?: boolean
  /** The neighbouring attempt, for one neutral difference line per card. */
  other?: { phrase: PhraseResult | null; name: string } | null
  /** Detail view: the secondary values. */
  detail: boolean
  narrow: boolean
  /** Under each explanation: a link to ask Mika about this attempt. */
  askHref?: string
}

export function ThemeCards({ phrase, view, focus, onToggleFocus, focusBusy, other, detail, narrow, askHref }: ThemeCardsProps) {
  const order = orderThemes(focus)
  const readings = order.map((k) => readTheme(phrase, k, view))
  const compact = (r: ThemeReading) => r.value === null && r.reasonCode !== null && COMPACT_REASONS.has(r.reasonCode)
  const full = readings.filter((r) => !compact(r))
  const slim = readings.filter(compact)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className={narrow ? 'v2-phr-cards is-grid' : 'v2-phr-cards'}>
        {full.map((r) => {
          const delta =
            other && r.value !== null
              ? themeDifference(r.key, readTheme(other.phrase, r.key), r, { a: other.name, b: 'This attempt' }).sentence
              : null
          return (
            <ThemeCard
              key={r.key}
              reading={r}
              focused={focus.includes(r.key)}
              onToggleFocus={onToggleFocus}
              focusBusy={focusBusy}
              focusFull={focus.length >= 3}
              delta={delta}
              detail={detail}
              askHref={askHref}
            />
          )
        })}
      </div>
      {slim.map((r) => (
        <CompactGap key={r.key} name={r.info.label} reason={null} detail={r.reasonCode ? COMPACT_TEXT[r.reasonCode] : undefined} />
      ))}
    </div>
  )
}

interface ThemeCardProps {
  reading: ThemeReading
  focused: boolean
  focusFull: boolean
  focusBusy?: boolean
  onToggleFocus?(key: ThemeKey): void
  delta: ReactNode
  detail: boolean
  askHref?: string
}

export function ThemeCard({ reading: r, focused, focusFull, focusBusy, onToggleFocus, delta, detail, askHref }: ThemeCardProps) {
  const none = r.value === null
  const cls = ['metric', 'v2-phr-card', none ? 'is-none' : r.confidence === 'low' ? 'is-low' : ''].filter(Boolean).join(' ')
  const reason = r.reason ?? (r.notes.length ? r.notes.join(' ') : null)
  return (
    <div className={cls}>
      <div className="metric-top">
        <span className="metric-name">{r.info.label}</span>
        <ConfBadge level={r.confidence} />
      </div>
      <div className="metric-value">
        {none ? NO_VALUE : r.text}
        {!none && <span className="metric-unit">{r.info.unit}</span>}
      </div>
      {r.signText && <p className="v2-phr-sign">{r.signText}</p>}
      {!none && delta && <p className="metric-delta">{delta}</p>}
      {reason && <p className="reason hatch">{reason}</p>}
      {r.viewNote && <p className="v2-phr-view">{r.viewNote}</p>}
      {detail && r.details.length > 0 && (
        <ul className="v2-phr-details">
          {r.details.map((d) => (
            <li key={d}>{d}</li>
          ))}
        </ul>
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <InfoDisclosure about={r.info.label}>
          <p className="t-small" style={{ flexBasis: '100%' }}>{r.info.about}</p>
          <p className="t-small subtle" style={{ flexBasis: '100%' }}>{r.info.viewNote}</p>
          {askHref && (
            <a className="v2-metric-info-ask" href={askHref}>
              <Icon name="mika" size={16} />
              Ask Mika about this
            </a>
          )}
        </InfoDisclosure>
        {onToggleFocus && (
          <label className="v2-phr-pin" title={!focused && focusFull ? 'Up to three focus themes; the first one you picked makes room.' : undefined}>
            <input type="checkbox" checked={focused} disabled={focusBusy} onChange={() => onToggleFocus(r.key)} />
            My focus
          </label>
        )}
      </div>
    </div>
  )
}
