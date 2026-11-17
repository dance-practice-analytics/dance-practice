// Progress screen body for phrase attempts: one chart per theme, the dancer's focus themes
// first, one camera view at a time. Values, medians and neutral change only.

import type { ReactNode } from 'react'
import { CompactGap, EmptyState } from '../../components'
import { VIEW_LABELS } from '../../format'
import { href } from '../../router'
import type { CameraView } from '../../../data/schema'
import { COMPACT_TEXT } from '../phrase/model'
import type { ThemeKey } from '../phrase/model'
import { ProgressChart, ProgressLegend } from './ProgressChart'
import type { PhraseProgressView } from './phraseModel'

export interface PhraseProgressProps {
  view: PhraseProgressView
  focus: readonly ThemeKey[]
  setCameraView(v: CameraView): void
  /** The date filter of the page (same control as for the other movements). */
  dateControl: ReactNode
}

export function PhraseProgress({ view, focus, setCameraView, dateControl }: PhraseProgressProps) {
  if (view.movementSessions === 0) {
    return (
      <EmptyState
        icon="progress"
        title="No Phrase sessions yet"
        action={
          <a className="btn btn-primary" href={href({ name: 'import' })}>
            Import clips
          </a>
        }
      >
        Import attempts of a phrase (movement “Phrase”); after two sessions filmed from the same view, each theme shows its change here.
      </EmptyState>
    )
  }
  const ordered = [...view.panels].sort((a, b) => rank(a.key, focus) - rank(b.key, focus))
  return (
    <>
      <div className="v2-prog-filters">
        {view.views.length > 0 && (
          <div className="field" style={{ flex: '0 1 auto' }}>
            <span className="field-label" id="prog-phr-view">
              Camera view
            </span>
            <div className="seg" role="radiogroup" aria-labelledby="prog-phr-view">
              {view.views.map((v) => (
                <button
                  key={v}
                  type="button"
                  role="radio"
                  aria-checked={v === view.cameraView}
                  className={v === view.cameraView ? 'on' : undefined}
                  onClick={() => setCameraView(v)}
                >
                  {VIEW_LABELS[v]}
                </button>
              ))}
            </div>
          </div>
        )}
        {dateControl}
      </div>
      {view.sessions.length === 0 ? (
        <EmptyState icon="filter" title="No sessions match these filters">
          No phrase session is in this camera view and date range. The reasons are listed below.
        </EmptyState>
      ) : (
        <>
          {view.sessions.length === 1 && (
            <p className="t-small muted">One phrase session in this view so far. After the next one, the change of each theme appears here.</p>
          )}
          <div className="v2-prog-legend t-small muted">
            <ProgressLegend />
            <span style={{ flex: 1 }} />
            <span>{view.sessionsNote}</span>
          </div>
          <div className="v2-prog-grid">
            {ordered
              .filter((p) => !p.empty)
              .map((panel) => (
                <figure key={panel.key} className="card v2-prog-card">
                  <figcaption style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                    <span className="t-small" style={{ fontWeight: 600 }}>
                      {panel.info.label}
                    </span>
                    {focus.includes(panel.key) ? <span className="tag">My focus</span> : <span className="tag">{panel.info.unit}</span>}
                  </figcaption>
                  <ProgressChart panel={panel} sessions={view.sessions} />
                  <p className="t-small muted">{panel.summary}</p>
                </figure>
              ))}
            {ordered
              .filter((p) => p.empty)
              .map((panel) => {
                const code = panel.sessions.flatMap((s) => s.points)[0]?.gap?.nullReason as keyof typeof COMPACT_TEXT | undefined
                return <CompactGap key={panel.key} name={panel.info.label} reason={null} detail={code ? COMPACT_TEXT[code]?.replace('this clip', 'any clip') : undefined} />
              })}
          </div>
          <p className="t-caption">
            Phrase themes are only charted against other phrase attempts. The median uses values with medium or high confidence; a cross is an attempt
            without a value, never counted as 0.
          </p>
        </>
      )}
      {view.excluded.length > 0 && (
        <section className="card" style={{ overflow: 'hidden' }} aria-labelledby="prog-phr-excluded">
          <div style={{ padding: '16px 16px 12px', display: 'flex', flexDirection: 'column', gap: 4 }}>
            <h2 className="t-h3" id="prog-phr-excluded">
              Sessions not shown
            </h2>
            <p className="t-small muted">Only phrase sessions of the same camera view are put on one chart.</p>
          </div>
          <ul className="v2-prog-excluded t-small">
            {view.excluded.map((e) => (
              <li key={e.sessionId}>
                <a href={href({ name: 'library', sessionId: e.sessionId })}>{e.what}</a>
                <span className="muted">{e.reason}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  )
}

function rank(key: ThemeKey, focus: readonly ThemeKey[]): number {
  const i = focus.indexOf(key)
  return i < 0 ? 10 : i
}
