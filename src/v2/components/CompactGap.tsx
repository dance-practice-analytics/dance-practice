// A metric that applies but had nothing to measure in this clip (e.g. "Knee over toes"
// without a plié): one quiet row with a small hatched swatch, spanning the grid width,
// instead of a full card with a big hatched box. Still a gap with its reason, never 0.
// Use `isCompactGap(reason)` from format.ts to decide; other reasons keep the full card.

import type { CSSProperties } from 'react'
import { COMPACT_GAP_TEXT, compactGapReason, NULL_REASON_TEXT } from '../format'

export interface CompactGapProps {
  /** Metric label, e.g. 'Knee over toes'. */
  name: string
  /** Null reason code or its NULL_REASON_TEXT sentence. */
  reason: string | null | undefined
  /** Makes the row a link (e.g. to Progress on the dashboard). */
  href?: string
  /** Replaces the short text after "not measured — ", e.g. 'no plié in either clip'. */
  detail?: string
  style?: CSSProperties
}

const ROW: CSSProperties = {
  gridColumn: '1 / -1',
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  minWidth: 0,
  padding: '8px 12px',
  border: '1px dashed var(--line)',
  borderRadius: 8,
  color: 'var(--text-2)',
  fontSize: 13,
  lineHeight: '18px',
  textDecoration: 'none',
}

const SWATCH: CSSProperties = {
  flex: 'none',
  width: 16,
  height: 16,
  borderRadius: 4,
  border: '1px solid var(--line-strong)',
}

export function CompactGap({ name, reason, href, detail, style }: CompactGapProps) {
  const code = compactGapReason(reason)
  const short = detail ?? (code && COMPACT_GAP_TEXT[code]) ?? 'no value in this clip'
  const full = code ? NULL_REASON_TEXT[code] : undefined
  const body = (
    <>
      <span className="hatch" aria-hidden="true" style={SWATCH} />
      <span style={{ minWidth: 0 }}>
        <span style={{ color: 'var(--text)', fontWeight: 500 }}>{name}</span> · not measured — {short}
      </span>
    </>
  )
  if (href) {
    return (
      <a href={href} title={full} style={{ ...ROW, ...style }}>
        {body}
      </a>
    )
  }
  return (
    <p role="note" title={full} style={{ ...ROW, margin: 0, ...style }}>
      {body}
    </p>
  )
}
