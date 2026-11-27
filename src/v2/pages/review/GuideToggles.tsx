// "Angles on the video": one toggle per guide (guides.ts). Off by default; any mix can be on.

import { DEPTH_GUIDES, GUIDE_ABOUT, GUIDE_KEYS, GUIDE_LABELS, type GuideKey } from './guides'

export interface GuideTogglesProps {
  value: readonly GuideKey[]
  onChange(next: GuideKey[]): void
  /** Compare's overlay draws them on B only. */
  note?: string
  disabled?: boolean
}

export function GuideToggles({ value, onChange, note, disabled }: GuideTogglesProps) {
  const on = new Set(value)
  const toggle = (k: GuideKey) => onChange(GUIDE_KEYS.filter((x) => (x === k ? !on.has(k) : on.has(x))))
  const depth = value.some((k) => DEPTH_GUIDES.has(k))
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span className="t-small" id="guides-label" style={{ fontWeight: 500 }}>
          Angles on the video
        </span>
        <div className="seg" role="group" aria-labelledby="guides-label" style={{ flexWrap: 'wrap', overflow: 'visible' }}>
          {GUIDE_KEYS.map((k) => (
            <button
              key={k}
              type="button"
              className={on.has(k) ? 'on' : undefined}
              aria-pressed={on.has(k)}
              disabled={disabled}
              title={GUIDE_ABOUT[k]}
              onClick={() => toggle(k)}
            >
              {GUIDE_LABELS[k]}
            </button>
          ))}
        </div>
      </div>
      {(value.length > 0 || note) && (
        <p className="t-caption">
          {value.length > 0 && 'Each value is for the frame on screen, from the same formula as its measurement. '}
          {depth && 'Knees and feet depend on depth, which one camera estimates poorly: read them as rough. '}
          {note}
        </p>
      )}
    </div>
  )
}
