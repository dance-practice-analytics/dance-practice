// Dashboard, dancer variant. Design: Dashboard.dc.html › DANCER and DashboardMobile.dc.html.
// A card whose data doesn't exist yet stays in place with one next step.

import { useMemo } from 'react'
import type { Library } from '../../data'
import { AttemptThumb, CompactGap, ConfBadge, Icon, Skeleton, StatusPill } from '../../components'
import { isCompactGap } from '../../format'
import { latestProcessed } from '../../data'
import { usePipeline } from '../../pipeline'
import { href } from '../../router'
import { AttemptTile, NextFocusCard, useTileLabel } from '../library/cards'
import { layoutSeries } from '../library/chart'
import { nextFocus, pickFocus, recentNotes, tileStatus, type LiveStatus, type Tile } from '../library/model'
import { nextStep } from '../library/nextStep'
import type { AccountNotes } from '../library/notes'
import {
  accountSummary,
  latestSession,
  metricTiles,
  otherMovement,
  practiceLine,
  processingSummary,
  type LatestSession,
  type MetricTile,
  type MovementCard,
} from './model'
import { Welcome } from './Welcome'

const CARD = { padding: 20, display: 'flex', flexDirection: 'column' as const, gap: 12, minWidth: 0 }
const HEAD = { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }

export interface DancerProps {
  data: Library
  notes: AccountNotes
  live: LiveStatus
  narrow: boolean
}

export function DancerDashboard({ data, notes, live, narrow }: DancerProps) {
  const { sessions, attempts } = data
  const latest = useMemo(() => latestSession(sessions, attempts, live), [sessions, attempts, live])
  const focus = useMemo(() => pickFocus(sessions, attempts), [sessions, attempts])
  const tiles = useMemo(() => (focus ? metricTiles(focus) : null), [focus])
  const other = useMemo(() => (focus ? otherMovement(focus) : null), [focus])
  const next = useMemo(() => (notes.notes ? nextFocus(notes.notes, attempts) : null), [notes.notes, attempts])
  const step = useMemo(() => nextStep(sessions, attempts), [sessions, attempts])
  const practice = useMemo(() => practiceLine(accountSummary(sessions, attempts)), [sessions, attempts])
  const notesHref = href({ name: 'notes', attemptId: latestProcessed(attempts)?.id })
  const hasSubjects = sessions.some((s) => s.subject_code)
  const prefix = hasSubjects && focus?.code ? `${focus.code} · ` : ''

  // First run (no clips yet): three steps, Import, or a synthetic sample session.
  if (attempts.length === 0) return <Welcome narrow={narrow} />

  if (narrow) {
    return (
      <>
        {latest && <LatestCardPhone latest={latest} />}
        <NextFocusCard focus={next} step={step} notes={notes} emptyHref={notesHref} compact showSubject={hasSubjects} />
        {tiles && (
          <>
            <div style={HEAD}>
              <h2 className="t-h3">
                {prefix}
                {tiles.heading}
              </h2>
              <a href={href({ name: 'progress' })} className="t-small">
                Progress
              </a>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
              {tiles.tiles.filter((t) => !compactTile(t)).map((t) => (
                <MetricTilePhone key={t.metric} tile={t} />
              ))}
              {tiles.tiles.filter(compactTile).map((t) => (
                <CompactGap key={t.metric} name={t.name} reason={t.note} href={href({ name: 'progress' })} />
              ))}
            </div>
            <p className="t-caption">{tiles.caption}</p>
          </>
        )}
        <ProcessingCard data={data} practice={practice} compact />
        <a className="btn btn-secondary btn-lg btn-block" href={href({ name: 'library' })}>
          All sessions
        </a>
      </>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'stretch' }}>
        {latest && <LatestCard latest={latest} showSubject={hasSubjects} />}
        <NextFocusCard focus={next} step={step} notes={notes} emptyHref={notesHref} showSubject={hasSubjects} style={{ flex: '1 1 300px' }} />
      </div>

      {tiles && (
        <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }} aria-labelledby="mt-h">
          <div style={{ ...HEAD, flexWrap: 'wrap' }}>
            <h2 className="t-h3" id="mt-h">
              {prefix}
              {tiles.heading}
            </h2>
            <a href={href({ name: 'progress' })} className="t-small">
              Open Progress
            </a>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(240px, 100%), 1fr))', gap: 12 }}>
            {tiles.tiles.filter((t) => !compactTile(t)).map((t) => (
              <MetricTileWide key={t.metric} tile={t} />
            ))}
            {tiles.tiles.filter(compactTile).map((t) => (
              <CompactGap key={t.metric} name={t.name} reason={t.note} href={href({ name: 'progress' })} />
            ))}
          </div>
          <p className="t-caption">{tiles.caption}</p>
        </section>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(300px, 100%), 1fr))', gap: 16 }}>
        <ProcessingCard data={data} practice={practice} />
        <RecentNotesCard data={data} notes={notes} emptyHref={notesHref} />
        {other && <MovementCardView card={other} prefix={prefix} />}
      </div>
    </div>
  )
}

// ---------- latest session ----------

function LatestActions({ latest, block }: { latest: LatestSession; block?: boolean }) {
  const cls = block ? 'btn btn-primary btn-lg btn-block' : 'btn btn-primary'
  return latest.review ? (
    <a className={cls} href={href({ name: 'review', attemptId: latest.review.id })}>
      Review attempt {latest.review.number}
    </a>
  ) : (
    <a className={cls} href={href({ name: 'processing' })}>
      Open processing queue
    </a>
  )
}

function LatestCard({ latest, showSubject }: { latest: LatestSession; showSubject: boolean }) {
  return (
    <section className="card" style={{ ...CARD, gap: 14, flex: '2 1 520px' }} aria-labelledby="ls-h">
      <div style={{ ...HEAD, gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <p className="t-label">Latest session{showSubject && latest.code ? ` · ${latest.code}` : ''}</p>
          <h2 className="t-h2" id="ls-h">
            {latest.title}
          </h2>
        </div>
        <span className="t-small muted">
          {latest.when} · {latest.attemptsText}
        </span>
      </div>
      <div style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 4 }}>
        {latest.tiles.map((t) => (
          <AttemptTile key={t.attempt.id} attempt={t.attempt} kind={t.kind} size="large" />
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <LatestActions latest={latest} />
        {latest.review && (
          <a className="btn btn-secondary" href={href({ name: 'chat', attemptId: latest.review.id })}>
            <Icon name="chat" />
            Ask about this session
          </a>
        )}
        <a className="btn btn-ghost" href={href({ name: 'library', sessionId: latest.session.id })}>
          All sessions
        </a>
      </div>
    </section>
  )
}

function PhoneTile({ tile }: { tile: Tile }) {
  const label = useTileLabel(tile.attempt.id, tile.kind)
  const hatched = tile.kind === 'low' || tile.kind === 'none'
  return (
    <a
      href={href({ name: 'review', attemptId: tile.attempt.id })}
      aria-label={`Attempt ${tile.attempt.number}, ${label}`}
      style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'center', textDecoration: 'none', color: 'var(--text)', minHeight: 64, minWidth: 0 }}
    >
      <AttemptThumb attempt={tile.attempt} className={hatched ? 'thumb v2-lib-hatch' : 'thumb'} style={{ width: '100%', height: 40 }} />
      <span className={`status st-${tileStatus(tile.kind)}`} style={{ fontSize: 11 }}>
        <span className="dot" style={{ width: 8, height: 8 }} aria-hidden="true" />#{tile.attempt.number}
      </span>
    </a>
  )
}

function LatestCardPhone({ latest }: { latest: LatestSession }) {
  return (
    <section className="card" style={{ ...CARD, padding: 16 }} aria-labelledby="dm-ls">
      <p className="t-label">Latest session{latest.code ? ` · ${latest.code}` : ''}</p>
      <h2 className="t-h3" id="dm-ls">
        {latest.title}
      </h2>
      <span className="t-small muted">{latest.when}</span>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 6 }}>
        {latest.tiles.map((t) => (
          <PhoneTile key={t.attempt.id} tile={t} />
        ))}
      </div>
      <p className="t-caption">{latest.statusLine}</p>
      <LatestActions latest={latest} block />
    </section>
  )
}

// ---------- metric tiles ----------

function Spark({ tile, height }: { tile: MetricTile; height: number }) {
  const { points, max, aria } = tile.trend
  const layout = layoutSeries(
    points.map((p) => p.median),
    max,
    { left: 10, right: 110, top: 4, bottom: 36 },
  )
  const withValue = layout.dots.filter((d) => d.y !== null)
  const last = withValue[withValue.length - 1]
  return (
    <svg viewBox="0 0 120 40" role="img" aria-label={aria} style={{ flex: 1, width: '100%', height, minWidth: 0 }}>
      {layout.lines.map((pts) => (
        <polyline key={pts} points={pts} fill="none" stroke="var(--series)" strokeWidth="2" />
      ))}
      {/* Sessions without a value: a dashed tick where the point would be. */}
      {layout.dots.map((d) =>
        d.y === null ? <line key={d.index} x1={d.x} y1="6" x2={d.x} y2="36" stroke="var(--line-strong)" strokeDasharray="2 4" /> : null,
      )}
      {last && <circle cx={last.x} cy={last.y!} r="3.5" fill="var(--surface)" stroke="var(--series)" strokeWidth="2" />}
    </svg>
  )
}

/** No value only because the clip had nothing to measure (e.g. no plié): a slim row, not a card. */
const compactTile = (t: MetricTile) => t.none && isCompactGap(t.note)

const tileClass = (t: MetricTile) => (t.none ? 'metric is-none' : t.low ? 'metric is-low' : 'metric')

function MetricTileWide({ tile }: { tile: MetricTile }) {
  return (
    <a href={href({ name: 'progress' })} className={tileClass(tile)} style={{ textDecoration: 'none', color: 'var(--text)' }}>
      <span className="metric-top">
        <span className="metric-name">{tile.name}</span>
        <ConfBadge level={tile.confidence} label={tile.confidenceLabel} />
      </span>
      {tile.single ? (
        // Fewer than two sessions with a value: the value alone, no one-dot chart.
        <>
          <span className="metric-value" style={{ fontSize: 32, lineHeight: '40px', whiteSpace: 'nowrap' }}>
            {tile.value}
            {!tile.none && <span className="metric-unit">{tile.unit}</span>}
          </span>
          <span className="t-small muted">{tile.about}</span>
        </>
      ) : (
        <span style={{ display: 'flex', alignItems: 'flex-end', gap: 12, minHeight: 40 }}>
          <span className="metric-value" style={{ fontSize: 26, lineHeight: '30px', whiteSpace: 'nowrap' }}>
            {tile.value}
            {!tile.none && <span className="metric-unit">{tile.unit}</span>}
          </span>
          <Spark tile={tile} height={40} />
        </span>
      )}
      {/* Pinned to the bottom so cards of one row line up whatever their content. */}
      <span style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {tile.delta && <span className="metric-delta">{tile.delta}</span>}
        {tile.note && (
          <span className="reason hatch" style={{ display: 'block' }}>
            {tile.note}
            {tile.none && ' Not shown as 0.'}
          </span>
        )}
      </span>
    </a>
  )
}

function MetricTilePhone({ tile }: { tile: MetricTile }) {
  return (
    <a href={href({ name: 'progress' })} className={tileClass(tile)} style={{ padding: 12, gap: 6, textDecoration: 'none', color: 'var(--text)' }}>
      <span className="metric-name" style={{ fontSize: 12, lineHeight: '16px' }}>
        {tile.name}
      </span>
      <span className="metric-value" style={tile.single ? { fontSize: 26, lineHeight: '32px' } : { fontSize: 22, lineHeight: '26px' }}>
        {tile.value}
        {!tile.none && (
          <span className="metric-unit" style={{ fontSize: 12 }}>
            {tile.unit}
          </span>
        )}
      </span>
      {tile.single ? (
        // Fewer than two sessions with a value: no one-dot chart, a plain line instead.
        <span className="t-caption">{tile.about}</span>
      ) : (
        <Spark tile={tile} height={32} />
      )}
      {tile.note ? (
        <span className="reason hatch" style={{ display: 'block', fontSize: 12, lineHeight: '16px', marginTop: 'auto' }}>
          {tile.none ? 'No tracking. ' : ''}
          {tile.note}
        </span>
      ) : (
        tile.delta && (
          <span className="metric-delta" style={{ fontSize: 12, lineHeight: '16px', marginTop: 'auto' }}>
            {tile.delta}
          </span>
        )
      )}
    </a>
  )
}

// ---------- processing ----------

/** Reads the queue itself, so only this card re-renders on every progress step. */
export function ProcessingCard({ data, practice, compact }: { data: Library; practice?: string; compact?: boolean }) {
  const { items } = usePipeline()
  const p = processingSummary(data.attempts, items)
  const idle = p.percent === null
  const share = p.total ? Math.round((p.done / p.total) * 100) : 0
  return (
    <section className="card" style={{ ...CARD, padding: compact ? 16 : 20, gap: compact ? 10 : 12 }} aria-labelledby="pr-h">
      <div style={HEAD}>
        <h2 className="t-h3" id="pr-h">
          Processing
        </h2>
        <a href={href({ name: 'processing' })} className="t-small">
          Open queue
        </a>
      </div>
      <p className="t-small muted">{p.line}</p>
      <div
        className={idle ? 'bar is-idle' : 'bar'}
        style={{ height: 8 }}
        role="progressbar"
        aria-valuenow={idle ? p.done : p.percent!}
        aria-valuemin={0}
        aria-valuemax={idle ? p.total : 100}
        aria-label={idle ? 'Clips processed' : 'Queue progress'}
      >
        <i style={{ width: `${idle ? share : p.percent}%` }} />
      </div>
      {p.active ? <StatusPill status="processing" label={p.active} /> : practice && <p className="t-caption">{practice}</p>}
    </section>
  )
}

// ---------- recent notes ----------

function RecentNotesCard({ data, notes, emptyHref }: { data: Library; notes: AccountNotes; emptyHref: string }) {
  const lines = useMemo(() => (notes.notes ? recentNotes(notes.notes, data.sessions, data.attempts) : []), [notes.notes, data])
  return (
    <section className="card" style={{ ...CARD, gap: 10 }} aria-labelledby="rn-h">
      <div style={HEAD}>
        <h2 className="t-h3" id="rn-h">
          Recent notes
        </h2>
        <a href={emptyHref} className="t-small">
          All notes
        </a>
      </div>
      {notes.loading ? (
        <div aria-busy="true" aria-label="Loading practice notes" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Skeleton height={12} width="60%" />
          <Skeleton height={10} width="40%" />
        </div>
      ) : notes.error ? (
        <>
          <p className="t-small muted">
            {notes.error.message} {notes.error.recovery}
          </p>
          <button className="btn btn-secondary btn-sm" type="button" onClick={notes.refetch} style={{ alignSelf: 'flex-start' }}>
            Try again
          </button>
        </>
      ) : lines.length === 0 ? (
        <>
          <p className="t-small muted">No practice notes yet. Notes are written from an attempt’s metrics only — never from the video.</p>
          <a className="btn btn-secondary btn-sm" href={emptyHref} style={{ alignSelf: 'flex-start' }}>
            Open practice notes
          </a>
        </>
      ) : (
        lines.map((l, i) => (
          <a
            key={l.id}
            className="v2-lib-plain"
            href={href({ name: 'notes', attemptId: l.attemptId })}
            style={{ display: 'flex', flexDirection: 'column', padding: '8px 0', borderBottom: i < lines.length - 1 ? '1px solid var(--line)' : undefined }}
          >
            <span className="t-small v2-lib-plain-t" style={{ fontWeight: 500 }}>
              {l.title}
            </span>
            <span className="t-caption">{l.meta}</span>
          </a>
        ))
      )}
    </section>
  )
}

// ---------- the other movement ----------

function MovementCardView({ card, prefix }: { card: MovementCard; prefix: string }) {
  const none = card.value === '—'
  return (
    <section className="card" style={{ ...CARD, gap: 10 }} aria-labelledby="pi-h">
      <div style={HEAD}>
        <h2 className="t-h3" id="pi-h">
          {prefix}
          {card.title}
        </h2>
        <span className="t-caption">
          {card.sessions} {card.sessions === 1 ? 'session' : 'sessions'}
        </span>
      </div>
      {card.sessions === 0 ? (
        <>
          <p className="t-small muted">{card.sentence} Import clips of this movement to see its measurements here.</p>
          <a className="btn btn-secondary btn-sm" href={href({ name: 'import' })} style={{ alignSelf: 'flex-start' }}>
            Import clips
          </a>
        </>
      ) : (
        <>
          <span className="metric-value" style={{ fontSize: 26, lineHeight: '30px', color: none ? 'var(--text-3)' : undefined }}>
            {card.value}
            <span className="metric-unit">{card.unit}</span>
          </span>
          <p className="metric-delta">{card.sentence}</p>
          {card.reason && <p className="reason hatch">{card.reason} Not shown as 0.</p>}
          <a className="btn btn-secondary btn-sm" href={href({ name: 'progress' })} style={{ alignSelf: 'flex-start' }}>
            See {card.title.toLowerCase()} progress
          </a>
        </>
      )}
    </section>
  )
}
