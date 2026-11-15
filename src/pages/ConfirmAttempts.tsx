// Confirm attempts and phases (Development Document 1.5). Boundaries start from
// the heel- and hip-height signals; the dancer checks each one against the pose
// and confirms. Measurements are only computed from confirmed boundaries.

import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react'
import type { Attempt, SessionResults } from '../types'
import { api, ApiError } from '../api/client'
import { navigate } from '../router'
import { boundaries, withBoundary } from '../lib/attempts'
import { PHASES } from '../lib/phases'
import { qualitySpans } from '../lib/series'
import { suggestAttempts, validateAttempts } from '../lib/suggest'
import { formatTime } from '../lib/format'
import { useElementWidth } from '../lib/hooks'
import { RELEVE_THRESHOLD } from '../mock/metricsEngine'
import { clock, useClock, useClockTime } from '../state/clock'
import { toast } from '../state/app'
import { AppBar } from '../components/AppBar'
import { PoseStage } from '../components/PoseStage'
import { PoseLoop } from '../components/PoseLoop'
import { ErrorState, Spinner } from '../components/ui'
import { track } from '../study/log'

const BOUNDARY_LABELS = ['Attempt starts', ...PHASES.map((p) => p.starts), 'Back to standing', 'Attempt ends']

interface Draft {
  attempt: Attempt
  estimated: number[]
  checked: boolean
}

interface Selection {
  attemptId: string
  k: number
}

function renumber(drafts: Draft[]): Draft[] {
  return [...drafts]
    .sort((a, b) => a.attempt.start - b.attempt.start)
    .map((d, i) => ({ ...d, attempt: { ...d.attempt, id: `a${i + 1}`, index: i + 1 } }))
}

/** Heel height across the whole clip, with editable attempt and phase boundaries. */
function SignalLane({ results, drafts, selection, onSelect, onMove, onCommit }: {
  results: SessionResults
  drafts: Draft[]
  selection: Selection | null
  onSelect: (s: Selection) => void
  onMove: (attemptId: string, k: number, t: number) => void
  onCommit: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const width = useElementWidth(ref)
  const { duration, fps } = results.session
  const H = 132
  const top = 18
  const x = (t: number) => (t / duration) * width
  const y = (v: number) => top + (1 - Math.max(0, Math.min(30, v)) / 30) * (H - top - 20)
  const scrubbing = useRef(false)

  const path = useMemo(() => {
    const segs: string[] = []
    let open = false
    for (const s of results.series.heelLift) {
      if (s.value === null) {
        open = false
        continue
      }
      segs.push(`${open ? 'L' : 'M'}${x(s.t).toFixed(1)},${y(s.value).toFixed(1)}`)
      open = true
    }
    return segs.join('')
  }, [results, width])

  const spans = useMemo(() => qualitySpans(results.series.heelLift, 0, duration, fps), [results, duration, fps])
  const timeAt = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect()
    return Math.min(duration, Math.max(0, ((clientX - r.left) / r.width) * duration))
  }

  const drag = (e: PointerEvent<SVGElement>, attemptId: string, k: number) => {
    e.stopPropagation()
    onSelect({ attemptId, k })
    const el = e.currentTarget
    el.setPointerCapture(e.pointerId)
    const move = (ev: globalThis.PointerEvent) => {
      const t = timeAt(ev.clientX)
      onMove(attemptId, k, t)
      clock.seek(t)
    }
    const up = () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      onCommit()
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
  }

  return (
    <div
      className="signal"
      ref={ref}
      onPointerDown={(e) => {
        scrubbing.current = true
        clock.seek(timeAt(e.clientX))
        e.currentTarget.setPointerCapture(e.pointerId)
      }}
      onPointerMove={(e) => scrubbing.current && clock.seek(timeAt(e.clientX))}
      onPointerUp={() => (scrubbing.current = false)}
    >
      {width > 0 && (
        <svg width={width} height={H} aria-label="Heel height across the clip, with attempt and phase boundaries">
          {spans.map((s) => <rect key={`${s.kind}${s.from}`} x={x(s.from)} width={Math.max(2, x(s.to) - x(s.from))} y={top} height={H - top - 20} fill={s.kind === 'missing' ? 'url(#hatch-missing)' : 'url(#hatch-low)'} />)}
          {drafts.map(({ attempt: a, checked }) => (
            <g key={a.id}>
              <rect x={x(a.start)} width={x(a.end) - x(a.start)} y={top - 14} height={H - top + 2} rx="8" className={`sig-attempt ${checked ? 'checked' : ''}`} />
              {a.phases.map((p) => <rect key={p.id} x={x(p.start)} width={x(p.end) - x(p.start)} y={top} height={H - top - 20} className={`sig-phase sig-${p.id}`} />)}
              <text x={x(a.start) + 6} y={top - 3} className="sig-label">{checked ? '✓ ' : ''}Attempt {a.index}</text>
            </g>
          ))}
          <line x1="0" x2={width} y1={y(RELEVE_THRESHOLD)} y2={y(RELEVE_THRESHOLD)} className="sig-threshold" />
          <text x={width - 4} y={y(RELEVE_THRESHOLD) - 4} textAnchor="end" className="sig-label muted">on relevé</text>
          <path d={path} className="sig-line" />
          {drafts.map(({ attempt: a, estimated }) =>
            boundaries(a).map((b, k) => {
              const on = selection?.attemptId === a.id && selection.k === k
              const edge = k === 0 || k === boundaries(a).length - 1
              return (
                <g key={`${a.id}-${k}`} className={`sig-handle ${on ? 'on' : ''} ${edge ? 'edge' : ''} ${estimated.includes(k) ? 'est' : ''}`} onPointerDown={(e) => drag(e, a.id, k)}>
                  <rect x={x(b) - 7} width="14" y={top - 14} height={H - top + 2} fill="transparent" />
                  <line x1={x(b)} x2={x(b)} y1={edge ? top - 14 : top} y2={H - 20} />
                  {!edge && <circle cx={x(b)} cy={H - 14} r={on ? 6 : 4.5} />}
                </g>
              )
            }),
          )}
          <Playhead x={x} height={H} />
        </svg>
      )}
    </div>
  )
}

function Playhead({ x, height }: { x: (t: number) => number; height: number }) {
  const t = useClockTime()
  return <line x1={x(t)} x2={x(t)} y1="0" y2={height} className="sig-playhead" />
}

function AddAtPlayhead({ onAdd }: { onAdd: () => void }) {
  const t = useClockTime()
  return <button className="btn btn-ghost" onClick={onAdd}>+ Add an attempt at {formatTime(t)}</button>
}

function MiniTransport({ fps }: { fps: number }) {
  const { time, playing, rate } = useClock()
  return (
    <div className="transport">
      <div className="transport-buttons">
        <button className="icon-btn" onClick={() => clock.seek(time - 1 / fps)} aria-label="Back one frame" title="Back one frame (←)">◀︎</button>
        <button className="play-btn" onClick={clock.toggle} aria-label={playing ? 'Pause' : 'Play'} title="Play or pause (Space)">{playing ? '❚❚' : '▶'}</button>
        <button className="icon-btn" onClick={() => clock.seek(time + 1 / fps)} aria-label="Forward one frame" title="Forward one frame (→)">▶︎</button>
      </div>
      <div className="transport-time"><b>{formatTime(time)}</b></div>
      <div className="seg seg-tight" role="group" aria-label="Playback speed">
        {[0.25, 0.5, 1].map((r) => <button key={r} className={`seg-btn ${rate === r ? 'on' : ''}`} onClick={() => clock.setRate(r)}>{r}×</button>)}
      </div>
    </div>
  )
}

export function ConfirmAttempts({ id }: { id: string }) {
  const [results, setResults] = useState<SessionResults | null>(null)
  const [drafts, setDrafts] = useState<Draft[]>([])
  const [selection, setSelection] = useState<Selection | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let live = true
    api.getSessionResults(id).then(
      (r) => {
        if (!live) return
        setResults(r)
        clock.pause()
        clock.setLoop(null)
        clock.setDuration(r.session.duration)
        // Editing confirmed attempts starts from them; a fresh session starts from suggestions.
        const initial: Draft[] = r.attempts.length
          ? r.attempts.map((attempt) => ({ attempt, estimated: [], checked: true }))
          : suggestAttempts(r).map((s) => ({ ...s, checked: false }))
        setDrafts(initial)
        if (initial[0]) {
          setSelection({ attemptId: initial[0].attempt.id, k: 1 })
          clock.seek(initial[0].attempt.phases[0].start)
        }
        track('confirm.loaded', { suggested: initial.length, editing: r.attempts.length > 0 })
      },
      (e) => live && setLoadError(e instanceof ApiError ? e.message : 'Couldn’t load this session.'),
    )
    return () => {
      live = false
    }
  }, [id])

  const fps = results?.session.fps ?? 30
  const duration = results?.session.duration ?? 0
  const problems = useMemo(() => validateAttempts(drafts.map((d) => d.attempt), duration), [drafts, duration])
  const selected = drafts.find((d) => d.attempt.id === selection?.attemptId) ?? drafts[0]

  const move = (attemptId: string, k: number, time: number) =>
    setDrafts((ds) => {
      const i = ds.findIndex((d) => d.attempt.id === attemptId)
      if (i < 0) return ds
      const lo = i > 0 ? ds[i - 1].attempt.end + 0.1 : 0
      const hi = i < ds.length - 1 ? ds[i + 1].attempt.start - 0.1 : duration
      const next = ds.slice()
      next[i] = { ...ds[i], attempt: withBoundary(ds[i].attempt, k, time, lo, hi, fps), estimated: ds[i].estimated.filter((e) => e !== k) }
      return next
    })

  const nudge = (frames: number) => {
    if (!selection || !selected) return
    const b = boundaries(selected.attempt)[selection.k] + frames / fps
    move(selection.attemptId, selection.k, b)
    clock.seek(b)
  }

  const select = (attemptId: string, k: number) => {
    setSelection({ attemptId, k })
    const d = drafts.find((x) => x.attempt.id === attemptId)
    if (d) {
      clock.pause()
      clock.seek(boundaries(d.attempt)[k])
    }
  }

  const setChecked = (attemptId: string, checked: boolean) => {
    track('confirm.checked', { checked })
    setDrafts((ds) => ds.map((d) => (d.attempt.id === attemptId ? { ...d, checked } : d)))
  }

  const remove = (attemptId: string) => {
    track('confirm.removed')
    setDrafts((ds) => renumber(ds.filter((d) => d.attempt.id !== attemptId)))
    setSelection(null)
  }

  const addAtPlayhead = () => {
    const start = Math.round(clock.get().time * fps) / fps
    const lens = [0.3, 1.4, 0.8, 1.6, 1.0, 0.4]
    const cuts = lens.reduce<number[]>((acc, l) => [...acc, acc[acc.length - 1] + l], [start])
    const end = cuts[cuts.length - 1]
    const overlaps = drafts.some((d) => start < d.attempt.end + 0.1 && end > d.attempt.start - 0.1)
    if (overlaps || end > duration) {
      toast('There isn’t room for a new attempt here. Move the playhead to a gap between attempts.')
      return
    }
    const c = results!.session.conditions
    const attempt: Attempt = {
      id: 'new',
      index: 0,
      start,
      end,
      phases: PHASES.map((p, i) => ({ id: p.id, label: p.label, start: Math.round(cuts[i + 1] * fps) / fps, end: Math.round(cuts[i + 2] * fps) / fps })),
      context: { view: c.view, music: c.music, fatigue: c.fatigue },
    }
    track('confirm.added')
    const next = renumber([...drafts, { attempt, estimated: [0, 1, 2, 3, 4, 5, 6], checked: false }])
    setDrafts(next)
    setSelection({ attemptId: next.find((d) => d.attempt.start === start)!.attempt.id, k: 1 })
  }

  // Space plays, arrows step a frame, [ and ] nudge the selected boundary.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea, button') && e.key === ' ') return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const now = clock.get().time
      if (e.key === ' ') {
        e.preventDefault()
        clock.toggle()
      } else if (e.key === 'ArrowLeft') clock.seek(now - 1 / fps)
      else if (e.key === 'ArrowRight') clock.seek(now + 1 / fps)
      else if (e.key === '[') nudge(-1)
      else if (e.key === ']') nudge(1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const confirm = async () => {
    if (!results) return
    setBusy(true)
    setSaveError(null)
    try {
      await api.putAttempts(id, { boundaryRevision: results.session.boundaryRevision, attempts: drafts.map((d) => d.attempt) })
      track('confirm.saved', { attempts: drafts.length })
      toast(`${drafts.length} attempts confirmed. Measurements are calculated from these boundaries.`)
      navigate({ name: 'workspace', id }, { replace: true })
    } catch (e) {
      setSaveError(e instanceof ApiError ? `${e.message} ${e.recovery ?? ''}` : 'Couldn’t save. Try again.')
      setBusy(false)
    }
  }

  if (loadError) return <div className="app"><AppBar /><main className="main"><ErrorState title="Can’t confirm attempts yet" message={loadError} action={<a className="btn" href={`#/sessions/${id}/processing`}>Go to processing</a>} /></main></div>
  if (!results) return <div className="app"><AppBar /><Spinner label="Finding your attempts…" /></div>

  const checkedCount = drafts.filter((d) => d.checked).length
  const allChecked = drafts.length > 0 && checkedCount === drafts.length
  const editing = results.attempts.length > 0
  const heel = results.metrics.find((m) => m.id === 'heelLift')!
  const date = new Date(results.session.recordedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

  return (
    <div className="app">
      <AppBar>
        <nav className="crumbs" aria-label="Breadcrumb"><a href="#/">Home</a><span>/</span><b>{date} session</b><span>/</span><b>Attempts</b></nav>
      </AppBar>
      <main className="main confirm">
        <section className="confirm-head">
          <div>
            <p className="kicker">{editing ? 'Edit attempts' : 'Step 4 · Confirm attempts'}</p>
            <h1>
              {drafts.length === 0 ? 'We couldn’t find any attempts' : editing ? `${drafts.length} attempts in this clip` : `We found ${drafts.length} attempts. Check each one.`}
            </h1>
            <p className="muted">
              The marks below are a starting point, read from your heel and hip height. Check that each one lands where you think it does, and drag or nudge it if not.
              Measurements are calculated only from what you confirm.
            </p>
          </div>
          <div className="confirm-progress" aria-label={`${checkedCount} of ${drafts.length} attempts checked`}>
            <b>{checkedCount}<span>/{drafts.length}</span></b>
            <small>checked</small>
          </div>
        </section>

        <section className="confirm-grid">
          <div className="stage-col">
            <div className="panel stage-panel">
              <div className="panel-head">
                <div>
                  <div className="panel-title">{selection && selected ? `Attempt ${selected.attempt.index} · ${BOUNDARY_LABELS[selection.k]}` : 'Practice clip'}</div>
                  <div className="panel-sub">Heel lines show how high you are. Synthetic pose; your video will play underneath.</div>
                </div>
              </div>
              <div className="stage stage-confirm">
                {selected && <PoseStage results={results} main={{ attempt: selected.attempt, timeFor: (x) => x }} metric={heel} guides />}
              </div>
            </div>
            <MiniTransport fps={fps} />
          </div>

          <div className="attempt-review">
            {drafts.map((d) => (
              <article key={d.attempt.id} className={`review-card ${d.checked ? 'checked' : ''} ${selected?.attempt.id === d.attempt.id ? 'on' : ''}`}>
                <header>
                  <div>
                    <b>Attempt {d.attempt.index}</b>
                    <small>{formatTime(d.attempt.start)}–{formatTime(d.attempt.end)} · hold {(d.attempt.phases[2].end - d.attempt.phases[2].start).toFixed(1)} s</small>
                  </div>
                  <div className="review-actions">
                    <button className="link-btn" onClick={() => remove(d.attempt.id)} title="Not an attempt? Remove it">Remove</button>
                    <label className={`check ${d.checked ? 'on' : ''}`}>
                      <input type="checkbox" checked={d.checked} onChange={(e) => setChecked(d.attempt.id, e.target.checked)} />
                      {d.checked ? 'Looks right' : 'Mark as checked'}
                    </label>
                  </div>
                </header>
                <ol className="keyframes">
                  {boundaries(d.attempt).slice(1, 6).map((b, j) => {
                    const k = j + 1
                    const on = selection?.attemptId === d.attempt.id && selection.k === k
                    return (
                      <li key={k}>
                        <button className={`keyframe ${on ? 'on' : ''} ${d.estimated.includes(k) ? 'est' : ''}`} onClick={() => select(d.attempt.id, k)} aria-pressed={on}>
                          <PoseLoop pose={results.pose} fps={fps} from={b} to={b + 1} still={b + 0.02} />
                          <span className="kf-label">{BOUNDARY_LABELS[k]}</span>
                          <span className="kf-time">{formatTime(b)}{d.estimated.includes(k) ? ' · estimated' : ''}</span>
                        </button>
                      </li>
                    )
                  })}
                </ol>
                {selection?.attemptId === d.attempt.id && (
                  <div className="nudge" role="group" aria-label="Adjust the selected mark">
                    <span>{BOUNDARY_LABELS[selection.k]}:</span>
                    <button className="seg-btn" onClick={() => nudge(-5)} title="5 frames earlier">«</button>
                    <button className="seg-btn" onClick={() => nudge(-1)} title="1 frame earlier ([)">‹ 1 frame</button>
                    <button className="seg-btn" onClick={() => nudge(1)} title="1 frame later (])">1 frame ›</button>
                    <button className="seg-btn" onClick={() => nudge(5)} title="5 frames later">»</button>
                    <button className="seg-btn" onClick={() => move(d.attempt.id, selection.k, clock.get().time)}>Set to playhead</button>
                  </div>
                )}
              </article>
            ))}
            <AddAtPlayhead onAdd={addAtPlayhead} />
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <div>
              <div className="panel-title">Heel height across the clip</div>
              <div className="panel-sub">Drag any mark. Dashed marks were estimated; hatching means tracking was weak or missing there.</div>
            </div>
          </div>
          <div className="signal-wrap">
            <SignalLane results={results} drafts={drafts} selection={selection} onSelect={(s) => select(s.attemptId, s.k)} onMove={move} onCommit={() => track('confirm.dragged')} />
          </div>
        </section>

        <footer className="confirm-foot">
          <div>
            {problems.length > 0 && <p className="form-error" role="alert">{problems[0].message}</p>}
            {saveError && <p className="form-error" role="alert">{saveError}</p>}
            {problems.length === 0 && !allChecked && drafts.length > 0 && <p className="muted">Check each attempt to continue. You can change these later from the session.</p>}
          </div>
          {editing && <a className="btn" href={`#/sessions/${id}`}>Cancel</a>}
          <button className="btn btn-primary btn-lg" disabled={!allChecked || problems.length > 0 || busy} onClick={confirm}>
            {busy ? 'Saving…' : `Confirm ${drafts.length} attempts →`}
          </button>
        </footer>
      </main>
    </div>
  )
}
