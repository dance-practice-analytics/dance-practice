// Dashboard, phrase focus: the latest session median of each theme and its neutral change
// from the dancer's first phrase session (same camera view). The dancer's focus themes
// come first. Phrase values are never mixed with relevé or pirouette values.

import { useMemo } from 'react'
import type { AttemptView } from '../../data'
import type { SessionSummary } from '../../../data/repo'
import { href } from '../../router'
import { useFocusThemes } from '../../focus'
import { buildPhraseProgress, phraseTiles } from '../progress/phraseModel'

export function PhraseTiles({ sessions, attempts, prefix, narrow }: { sessions: SessionSummary[]; attempts: AttemptView[]; prefix: string; narrow: boolean }) {
  const focus = useFocusThemes()
  const view = useMemo(() => buildPhraseProgress(sessions, attempts, {}), [sessions, attempts])
  const tiles = useMemo(() => phraseTiles(view, focus.themes), [view, focus.themes])
  const shown = narrow ? tiles.slice(0, 4) : tiles
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }} aria-labelledby="phr-tiles-h">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <h2 className="t-h3" id="phr-tiles-h">
          {prefix}Phrase · themes by session
        </h2>
        <a href={href({ name: 'progress' })} className="t-small">
          Open Progress
        </a>
      </div>
      <div
        className={narrow ? 'v2-dash-tiles' : undefined}
        style={narrow ? undefined : { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(220px, 100%), 1fr))', gap: 12 }}
      >
        {shown.map((t) => (
          <a key={t.key} href={href({ name: 'progress' })} className={t.none ? 'metric is-none' : 'metric'} style={{ textDecoration: 'none', color: 'var(--text)' }}>
            <span className="metric-top">
              <span className="metric-name">{t.name}</span>
              {focus.themes.includes(t.key) && <span className="tag">My focus</span>}
            </span>
            <span className="metric-value" style={{ fontSize: narrow ? 22 : 26, lineHeight: '30px', whiteSpace: 'nowrap' }}>
              {t.value}
              {!t.none && <span className="metric-unit">{t.unit}</span>}
            </span>
            {/* Pinned to the bottom so the cards of one row line up. */}
            <span className={t.none ? 'reason hatch' : 'metric-delta'} style={{ display: 'block', marginTop: 'auto' }}>
              {t.delta}
            </span>
          </a>
        ))}
      </div>
      <p className="t-caption">
        Latest session medians{view.cameraView && view.cameraView !== 'unknown' ? `, ${view.cameraView} view` : ''}. Compared with your own first phrase session only.
      </p>
    </section>
  )
}
