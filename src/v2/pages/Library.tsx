// Screen 4 — Library ("My practice" on the phone).
// Design: Library.dc.html (wide), LibraryMobile.dc.html (phone); empty / loading / error
// patterns in States.dc.html. The view-model is in ./library/model.ts.

import { useEffect, useMemo, useState } from 'react'
import { CAMERA_VIEWS, MOVEMENT_TYPES, type CameraView, type MovementType } from '../../data/schema'
import { useAuth } from '../auth'
import { EmptyState, ErrorAlert, Icon, PageHeader, PrivacyPill, Skeleton, SkeletonList } from '../components'
import { latestProcessed, useLibrary } from '../data'
import { MOVEMENT_LABELS, VIEW_LABELS } from '../format'
import { href, useRoute } from '../router'
import { useIsNarrow } from '../useIsNarrow'
import { AttemptTile, NextFocusCard, TrendCard, TrendCardCompact } from './library/cards'
import { useLiveStatus, useWho } from './library/hooks'
import './library/library.css'
import {
  GROUP_PAGE,
  NO_FILTERS,
  PERSONAL,
  PERSONAL_LABEL,
  TILE_LABEL,
  buildLibrary,
  describeFilters,
  hasFilters,
  mobileGroups,
  nextFocus,
  pickFocus,
  plural,
  showMoreLabel,
  subjectKey,
  type Filters,
  type LibraryModel,
  type StatusFilter,
  type SubjectGroup,
} from './library/model'
import { useAccountNotes } from './library/notes'

const MOVEMENT_SHORT: Record<MovementType, string> = { releve_balance: 'Relevé', pirouette: 'Pirouette' }
const STATUS_CHIPS: StatusFilter[] = ['all', 'done', 'processing', 'queued', 'failed']

export function Library() {
  const lib = useLibrary()
  const { role } = useAuth()
  const who = useWho()
  const narrow = useIsNarrow()
  const route = useRoute()
  const notes = useAccountNotes()
  const live = useLiveStatus()
  const [filters, setFilters] = useState<Filters>(NO_FILTERS)
  const [overrides, setOverrides] = useState<Record<string, boolean>>({})
  const [showAll, setShowAll] = useState(false)

  const data = lib.data
  const model = useMemo(() => (data ? buildLibrary(data.sessions, data.attempts, filters, live) : null), [data, filters, live])
  const focus = useMemo(
    () => (data ? pickFocus(data.sessions, data.attempts, filters) : null),
    [data, filters.subject, filters.movement], // eslint-disable-line react-hooks/exhaustive-deps
  )
  const next = useMemo(
    () => (data && notes.notes ? nextFocus(notes.notes, data.attempts, filters.subject) : null),
    [data, notes.notes, filters.subject],
  )

  const targetId = route.name === 'library' ? route.sessionId : undefined
  const targetKey = useMemo(() => {
    const s = targetId ? data?.sessions.find((x) => x.id === targetId) : undefined
    return s ? subjectKey(s) : null
  }, [data, targetId])

  // #/library?session=<id>: bring that session into view once it is on screen.
  useEffect(() => {
    if (!targetId || !model) return
    document.getElementById(`lib-s-${targetId}`)?.scrollIntoView({ block: 'center' })
  }, [targetId, model === null]) // eslint-disable-line react-hooks/exhaustive-deps

  const set = (patch: Partial<Filters>) => setFilters((f) => ({ ...f, ...patch }))
  const clear = () => setFilters(NO_FILTERS)

  const hasSubjects = !!data?.sessions.some((s) => s.subject_code)
  const clips = data?.attempts.length ?? 0
  const subtitle = !data
    ? 'Your clips, grouped by subject and movement.'
    : hasSubjects
      ? `${plural(model?.subjects.filter((k) => k !== PERSONAL).length ?? 0, 'subject')} · ${plural(clips, 'clip')} · grouped by subject and movement`
      : `${plural(data.sessions.length, 'session')} · ${plural(clips, 'clip')} · grouped by movement and session`

  const notesHref = href({ name: 'notes', attemptId: latestProcessed(data?.attempts)?.id })
  const empty = !!data && clips === 0
  const filtered = hasFilters(filters)
  const isOpen = (g: SubjectGroup, count: number) =>
    overrides[g.key] ?? (filtered || count <= 2 || g.active || g.key === targetKey || g.key === focus?.key)
  const toggle = (g: SubjectGroup, open: boolean) => setOverrides((o) => ({ ...o, [g.key]: !open }))

  const noMatch = (
    <EmptyState
      icon="filter"
      title="No clips match these filters"
      action={
        <button className="btn btn-ghost" type="button" onClick={clear}>
          Clear filters
        </button>
      }
    >
      Nothing matches {describeFilters(filters)}. Your clips are still here.
    </EmptyState>
  )

  return (
    <>
      <PageHeader
        title="Library"
        mobileTitle="My practice"
        eyebrow={role === 'researcher' ? 'Study clips' : `Signed in as ${who}`}
        subtitle={subtitle}
        actions={
          <>
            <PrivacyPill>Clips processed on this device, not uploaded</PrivacyPill>
            <a className="btn btn-primary" href={href({ name: 'import' })}>
              <Icon name="import" />
              Import clips
            </a>
          </>
        }
        mobileActions={
          <a className="btn btn-ghost btn-icon btn-lg" href={href({ name: 'import' })} aria-label="Import clips">
            <Icon name="plus" style={{ width: 20, height: 20 }} />
          </a>
        }
      />
      {narrow && <PrivacyPill style={{ alignSelf: 'flex-start' }} />}
      {lib.error && <ErrorAlert error={lib.error} onRetry={lib.refetch} />}

      {lib.loading ? (
        <LoadingLibrary narrow={narrow} />
      ) : !data || !model ? null : empty ? (
        <EmptyState
          icon="review"
          title="No clips yet"
          action={
            <a className="btn btn-primary" href={href({ name: 'import' })}>
              Import clips
            </a>
          }
        >
          Import study clips or a video of your own. Study clips are processed on this device and never uploaded.
        </EmptyState>
      ) : narrow ? (
        <>
          <NextFocusCard focus={next} notes={notes} emptyHref={notesHref} compact showSubject={hasSubjects} />
          {focus && <TrendCardCompact focus={focus} />}
          <div className="v2-lib-chips" role="group" aria-label="Filter clips">
            <button className={filtered ? 'chip' : 'chip on'} type="button" aria-pressed={!filtered} onClick={clear}>
              All
            </button>
            {MOVEMENT_TYPES.map((m) => {
              const on = filters.movement === m
              return (
                <button key={m} className={on ? 'chip on' : 'chip'} type="button" aria-pressed={on} onClick={() => set({ movement: on ? 'all' : m })}>
                  {MOVEMENT_LABELS[m]}
                </button>
              )
            })}
            <button
              className={filters.attention ? 'chip on' : 'chip'}
              type="button"
              aria-pressed={filters.attention}
              onClick={() => set({ attention: !filters.attention })}
            >
              Needs attention
            </button>
          </div>
          {model.shown === 0 ? noMatch : <PhoneGroups model={model} />}
        </>
      ) : (
        <>
          <FilterBar filters={filters} model={model} set={set} />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, alignItems: 'flex-start' }}>
            <section style={{ flex: '999 1 560px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 12 }} aria-label="Clips by subject">
              {model.shown === 0
                ? noMatch
                : (showAll ? model.groups : model.groups.slice(0, GROUP_PAGE)).map((g) => {
                    const open = isOpen(g, model.groups.length)
                    return <GroupCard key={g.key} group={g} open={open} onToggle={() => toggle(g, open)} targetId={targetId} />
                  })}
              {model.shown > 0 && !showAll && model.groups.length > GROUP_PAGE && (
                <button className="btn btn-ghost" type="button" style={{ alignSelf: 'flex-start' }} onClick={() => setShowAll(true)}>
                  {showMoreLabel(model.groups.slice(GROUP_PAGE))}
                </button>
              )}
            </section>
            <aside style={{ flex: '1 1 300px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
              <NextFocusCard focus={next} notes={notes} emptyHref={notesHref} showSubject={hasSubjects} />
              {focus && <TrendCard focus={focus} showSubject={hasSubjects} />}
            </aside>
          </div>
        </>
      )}
    </>
  )
}

// ---------- wide: filters ----------

function FilterBar({ filters, model, set }: { filters: Filters; model: LibraryModel; set(patch: Partial<Filters>): void }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
      <div style={{ position: 'relative', flex: '0 1 260px' }}>
        <label htmlFor="lib-q" className="v2-sr">
          Search clips
        </label>
        <input
          className="input input-sm"
          id="lib-q"
          type="search"
          placeholder="Search file or subject code"
          style={{ paddingLeft: 34 }}
          value={filters.q}
          onChange={(e) => set({ q: e.target.value })}
        />
        <Icon name="search" size={16} style={{ position: 'absolute', left: 11, top: 10, color: 'var(--text-3)' }} />
      </div>
      <label className="chip v2-lib-pick">
        Subject:
        <select value={filters.subject} onChange={(e) => set({ subject: e.target.value })} aria-label="Subject">
          <option value="all">All</option>
          {model.subjects.map((k) => (
            <option key={k} value={k}>
              {k === PERSONAL ? PERSONAL_LABEL : k}
            </option>
          ))}
        </select>
        <Icon name="chevron-down" />
      </label>
      <div className="seg" role="group" aria-label="Movement">
        <button type="button" className={filters.movement === 'all' ? 'on' : ''} aria-pressed={filters.movement === 'all'} onClick={() => set({ movement: 'all' })}>
          All movements
        </button>
        {MOVEMENT_TYPES.map((m) => (
          <button key={m} type="button" className={filters.movement === m ? 'on' : ''} aria-pressed={filters.movement === m} onClick={() => set({ movement: m })}>
            {MOVEMENT_SHORT[m]}
          </button>
        ))}
      </div>
      <label className="chip v2-lib-pick">
        View:
        <select value={filters.view} onChange={(e) => set({ view: e.target.value as CameraView | 'any' })} aria-label="Camera view">
          <option value="any">Any</option>
          {CAMERA_VIEWS.map((v) => (
            <option key={v} value={v}>
              {VIEW_LABELS[v].replace(/ view$/, '')}
            </option>
          ))}
        </select>
        <Icon name="chevron-down" />
      </label>
      <div role="group" aria-label="Status" style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
        <span style={{ width: 1, height: 24, background: 'var(--line)' }} aria-hidden="true" />
        {STATUS_CHIPS.map((s) => {
          const on = filters.status === s
          return (
            <button key={s} className={on ? 'chip on' : 'chip'} type="button" aria-pressed={on} onClick={() => set({ status: s })}>
              {s === 'all' ? 'All' : TILE_LABEL[s]} <span className="num subtle">{model.counts[s]}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ---------- wide: one subject ----------

function GroupCard({ group, open, onToggle, targetId }: { group: SubjectGroup; open: boolean; onToggle(): void; targetId?: string }) {
  const panel = `lib-g-${group.key}`
  return (
    <div className="card" style={{ overflow: 'hidden' }}>
      <button type="button" className="v2-lib-head" aria-expanded={open} aria-controls={panel} onClick={onToggle}>
        <Icon name="chevron-right" size={16} style={{ color: 'var(--text-3)', flex: 'none', transform: open ? 'rotate(90deg)' : 'none' }} />
        {group.code ? <span className="subj">{group.code}</span> : <span className="tag">{PERSONAL_LABEL}</span>}
        <span style={{ fontWeight: 600 }}>{group.summary}</span>
        <span style={{ flex: 1 }} />
        <span className={`status st-${group.status.status}`}>
          <span className="dot" aria-hidden="true" />
          {group.status.text}
        </span>
      </button>
      {open && (
        <div id={panel} style={{ borderTop: '1px solid var(--line)', display: 'flex', flexDirection: 'column' }}>
          {group.sessions.map((b) => (
            <div
              key={b.session.id}
              id={`lib-s-${b.session.id}`}
              className={b.session.id === targetId ? 'v2-lib-session is-target' : 'v2-lib-session'}
              style={{ display: 'flex', flexWrap: 'wrap', gap: '12px 20px', alignItems: 'center', padding: '14px 16px 14px 44px', borderBottom: '1px solid var(--line)' }}
            >
              <div style={{ flex: '1 1 200px', display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                <span style={{ fontWeight: 500 }}>{b.title}</span>
                <span className="t-caption">{b.meta}</span>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {b.tiles.map((t) => (
                  <AttemptTile key={t.attempt.id} attempt={t.attempt} kind={t.kind} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ---------- phone: movement groups, one row per session ----------

function PhoneGroups({ model }: { model: LibraryModel }) {
  const groups = useMemo(() => mobileGroups(model.groups), [model.groups])
  return (
    <>
      {groups.map((g) => (
        <section key={g.key} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <h2 className="t-label">{g.title}</h2>
          <div className="card" style={{ overflow: 'hidden' }}>
            {g.rows.map((r) => (
              <a key={r.block.session.id} className="v2-lib-row" href={href({ name: 'review', attemptId: r.attemptId })}>
                <div className={r.status.status === 'done' && /low|no tracking/.test(r.status.text) ? 'thumb v2-lib-hatch' : 'thumb'} style={{ width: 56, height: 40, flex: 'none' }} />
                <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ fontWeight: 500 }}>{r.title}</span>
                  <span className={`status st-${r.status.status}`} style={{ whiteSpace: 'normal' }}>
                    <span className="dot" aria-hidden="true" />
                    {r.status.text}
                  </span>
                </div>
                <Icon name="chevron-right" size={18} style={{ color: 'var(--text-3)', flex: 'none' }} />
              </a>
            ))}
          </div>
        </section>
      ))}
    </>
  )
}

// ---------- loading ----------

function LoadingLibrary({ narrow }: { narrow: boolean }) {
  const side = (
    <div className="card" style={{ padding: narrow ? 16 : 20, display: 'flex', flexDirection: 'column', gap: 12 }} aria-hidden="true">
      <Skeleton height={12} width="40%" />
      <Skeleton height={18} width="75%" />
      <Skeleton height={64} />
    </div>
  )
  if (narrow) {
    return (
      <>
        {side}
        <SkeletonList rows={4} label="Loading library" />
      </>
    )
  }
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, alignItems: 'flex-start' }}>
      <div style={{ flex: '999 1 560px', minWidth: 0 }}>
        <SkeletonList rows={5} label="Loading library" />
      </div>
      <div style={{ flex: '1 1 300px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
        {side}
        {side}
      </div>
    </div>
  )
}
