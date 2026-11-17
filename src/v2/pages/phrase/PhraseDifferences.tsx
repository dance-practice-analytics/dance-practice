// Compare, phrase attempts: one neutral line per theme ("B reaches 0.08 arm lengths
// further than A") with both values and their confidence, and how the two attempts were
// lined up (the matched main leg extension). Descriptive only: no better or worse.

import type { CameraView } from '../../../data/schema'
import type { PhraseResult } from '../../../metrics/phrase'
import type { PhraseAlignment } from '../../../metrics/phraseAlign'
import { ConfBadge, NoteBox } from '../../components'
import { formatNumber, formatTimecode, VIEW_LABELS } from '../../format'
import { compareThemes, eventShort, type ThemeKey } from './model'
import './phrase.css'

export interface PhraseDifferencesProps {
  a: PhraseResult | null
  b: PhraseResult | null
  viewA: CameraView | null
  viewB: CameraView | null
  alignment: PhraseAlignment | null
  focus: readonly ThemeKey[]
  simple: boolean
}

export function PhraseDifferences({ a, b, viewA, viewB, alignment, focus, simple }: PhraseDifferencesProps) {
  if (!a || !b) {
    return (
      <NoteBox title="One of these attempts hasn’t been processed as a phrase yet.">
        Process it again on this device; its events and theme measures appear here afterwards.
      </NoteBox>
    )
  }
  const rows = compareThemes(a, b, focus)
  const differentView = viewA !== null && viewB !== null && viewA !== viewB
  const anchor = alignment?.anchorPair ?? null
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }} aria-labelledby="cmp-phr-h">
      <h2 className="t-h3" id="cmp-phr-h">
        Differences by theme
      </h2>
      <p className="t-caption">B compared with A. Values describe each clip; they are not scores.</p>
      {anchor && (
        <p className="t-small">
          Main leg extension: {eventShort(a.events[anchor.a])} at <span className="mono">{formatTimecode(a.events[anchor.a].peak)}</span> in A,{' '}
          {eventShort(b.events[anchor.b])} at <span className="mono">{formatTimecode(b.events[anchor.b].peak)}</span> in B.
          {alignment && ` ${alignment.pairs.length} events matched in order.`}
        </p>
      )}
      {!anchor && alignment && alignment.pairs.length === 0 && (
        <p className="t-small muted">No events were matched between A and B, so the clips are lined up by length.</p>
      )}
      {differentView ? (
        <NoteBox title="These attempts were filmed from different camera views.">
          {VIEW_LABELS[viewA!]} and {VIEW_LABELS[viewB!].toLowerCase()} read the same movement differently, so their theme values aren’t compared. Pick two
          attempts with the same view.
        </NoteBox>
      ) : (
        <ul style={{ display: 'flex', flexDirection: 'column', gap: 10, listStyle: 'none', margin: 0, padding: 0 }}>
          {rows.map((d) => (
            <li key={d.key} className="v2-phr-diff" style={d.delta === null ? { borderStyle: 'dashed' } : undefined}>
              <span style={{ fontWeight: 600 }}>
                {d.a.info.label}
                {focus.includes(d.key) && <span className="tag" style={{ marginLeft: 8 }}>My focus</span>}
              </span>
              <p style={{ margin: 0, color: d.delta === null ? 'var(--text-2)' : 'var(--text)' }}>
                {d.sentence}
                {!simple && d.delta !== null && d.delta !== 0 && (
                  <span className="t-caption num" style={{ marginLeft: 8, whiteSpace: 'nowrap' }}>
                    B − A = {formatNumber(d.delta, d.a.info.decimals)}
                    {d.a.info.unitShort}
                  </span>
                )}
              </p>
              <div className="v2-phr-diff-vals num muted">
                <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
                  A {d.a.text}
                  {d.a.shown !== null ? d.a.info.unitShort : ''} <ConfBadge level={d.a.confidence} />
                </span>
                <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
                  B {d.b.text}
                  {d.b.shown !== null ? d.b.info.unitShort : ''} <ConfBadge level={d.b.confidence} />
                </span>
              </div>
              {d.delta === null && [d.a.reason, d.b.reason].filter(Boolean).length > 0 && (
                <span className="t-caption">
                  {d.a.reason === d.b.reason ? d.a.reason : [d.a.reason && `A: ${d.a.reason}`, d.b.reason && `B: ${d.b.reason}`].filter(Boolean).join(' ')}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
