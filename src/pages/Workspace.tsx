// The review workspace: one screen for watching, measuring, comparing and
// reflecting ("one workspace, not multiple tabs", Development Document 1.1).

import { useEffect, useMemo, useState } from 'react'
import type { SessionResults } from '../types'
import { api, ApiError, download, type ExportFormat } from '../api/client'
import { navigate } from '../router'
import { StudioProvider, useStudio } from '../state/studio'
import { clock } from '../state/clock'
import { toast } from '../state/app'
import { track } from '../study/log'
import { AppBar } from '../components/AppBar'
import { GoalBar } from '../components/GoalBar'
import { StageArea } from '../components/StageArea'
import { MetricPanel } from '../components/MetricPanel'
import { Timeline } from '../components/Timeline'
import { AttemptStrip } from '../components/AttemptStrip'
import { ComparePanel } from '../components/ComparePanel'
import { NotesPanel } from '../components/NotesPanel'
import { Companion } from '../components/Companion'
import { ReflectionSheet } from '../components/ReflectionSheet'
import { CommandPalette, useCommands, type Command } from '../components/CommandPalette'
import { Onboarding, seenOnboarding } from '../components/Onboarding'
import { Dialog, ErrorState, SaveIndicator, Spinner } from '../components/ui'

function useShortcuts() {
  const { dispatch, results } = useStudio()
  const { fps } = results.session
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      if (el.closest('input, textarea, [contenteditable], dialog') || e.metaKey || e.ctrlKey || e.altKey) return
      const { time } = clock.get()
      if (e.key === ' ') {
        e.preventDefault()
        clock.toggle()
      } else if (e.key === 'ArrowLeft') clock.seek(time - 1 / fps)
      else if (e.key === 'ArrowRight') clock.seek(time + 1 / fps)
      else if (e.key === 'm' || e.key === 'M') dispatch({ type: 'addMarker', t: time, text: '', author: 'dancer' })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [dispatch, fps])
}

function DeleteDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { results } = useStudio()
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const remove = async () => {
    setBusy(true)
    setError(null)
    try {
      await api.deleteSession(results.session.id)
      track('session.deleted')
      toast('Session deleted, with its video, pose data, measurements and notes.')
      navigate({ name: 'journal' }, { replace: true })
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'The session couldn’t be fully deleted. Nothing is reported as deleted until everything is gone; try again.')
      setBusy(false)
    }
  }
  return (
    <Dialog open={open} onClose={onClose} title="Delete this session">
      <div className="danger">
        <p>This permanently deletes the clip, its pose data, every measurement, your moments and your reflection. It can’t be undone. Export first if you want to keep the numbers.</p>
        <label className="field">
          <span>Type <b>delete</b> to confirm</span>
          <input value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus spellCheck={false} />
        </label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="reflect-actions">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-danger" disabled={typed.trim().toLowerCase() !== 'delete' || busy} onClick={remove}>{busy ? 'Deleting…' : 'Delete permanently'}</button>
        </div>
      </div>
    </Dialog>
  )
}

function SessionMenu({ onExport, onDelete, onHelp }: { onExport: (f: ExportFormat) => void; onDelete: () => void; onHelp: () => void }) {
  const { results } = useStudio()
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [open])
  const item = (label: string, run: () => void, danger = false) => (
    <button role="menuitem" className={danger ? 'danger-item' : ''} onPointerDown={(e) => e.stopPropagation()} onClick={() => { setOpen(false); run() }}>{label}</button>
  )
  return (
    <div className="menu-wrap">
      <button className="icon-btn" aria-haspopup="menu" aria-expanded={open} aria-label="Session options" title="Session options" onPointerDown={(e) => e.stopPropagation()} onClick={() => setOpen(!open)}>⋯</button>
      {open && (
        <div className="menu" role="menu">
          {item('Edit attempts and phases', () => navigate({ name: 'confirm', id: results.session.id }))}
          {item('Export measurements (JSON)', () => onExport('json'))}
          {item('Export measurements (CSV)', () => onExport('csv'))}
          {item('How to read this', onHelp)}
          {item('Command palette  Ctrl+K', () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true })))}
          <hr />
          {item('Delete session…', onDelete, true)}
        </div>
      )}
    </div>
  )
}

type InspectorTab = 'measure' | 'attempts' | 'compare' | 'notes'

/** Right-hand inspector: one panel at a time, so the stage and timeline stay on screen. */
function Inspector() {
  const { state, attemptById } = useStudio()
  const [tab, setTab] = useState<InspectorTab>('measure')
  useEffect(() => {
    if (state.mode === 'compare') setTab('compare')
  }, [state.mode])
  useEffect(() => {
    if (state.reflectOpen) setTab('notes')
  }, [state.reflectOpen])
  const a = attemptById(state.compare.a)
  const b = attemptById(state.compare.b)
  const tabs: { id: InspectorTab; label: string; badge?: string }[] = [
    { id: 'measure', label: 'Measurements' },
    { id: 'attempts', label: 'Attempts', badge: String(state.attempts.length) },
    { id: 'compare', label: 'Compare', badge: `${a.index}·${b.index}` },
    { id: 'notes', label: 'Notes', badge: state.markers.length ? String(state.markers.length) : undefined },
  ]
  return (
    <section className="panel inspector">
      <div className="inspector-tabs" role="tablist" aria-label="Inspector">
        {tabs.map((t) => (
          <button key={t.id} role="tab" id={`tab-${t.id}`} aria-selected={tab === t.id} aria-controls="inspector-body" className={tab === t.id ? 'on' : ''} onClick={() => { setTab(t.id); track('ui.inspector', { tab: t.id }) }}>
            {t.label}
            {t.badge && <span className="tab-badge">{t.badge}</span>}
          </button>
        ))}
      </div>
      <div className="inspector-body" id="inspector-body" role="tabpanel" aria-labelledby={`tab-${tab}`}>
        {tab === 'measure' && <MetricPanel />}
        {tab === 'attempts' && <AttemptStrip />}
        {tab === 'compare' && <ComparePanel />}
        {tab === 'notes' && <NotesPanel />}
      </div>
    </section>
  )
}

function Studio() {
  const { results, state, dispatch } = useStudio()
  const [deleting, setDeleting] = useState(false)
  const [help, setHelp] = useState(() => !seenOnboarding())
  useShortcuts()

  const exportAs = async (format: ExportFormat) => {
    try {
      const blob = await api.exportSession(results.session.id, format)
      download(blob, `dad-${results.session.participant}-${results.session.recordedAt.slice(0, 10)}.${format}`)
      track('session.exported', { format })
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'The export didn’t finish. Nothing partial was saved; try again.')
    }
  }

  const extra = useMemo<Command[]>(
    () => [
      { id: 'export-json', group: 'Session', label: 'Export measurements (JSON)', run: () => exportAs('json') },
      { id: 'export-csv', group: 'Session', label: 'Export measurements (CSV)', run: () => exportAs('csv') },
      { id: 'help', group: 'Session', label: 'How to read this', run: () => setHelp(true) },
    ],
    [results.session.id],
  )
  const commands = useCommands(extra)
  const date = new Date(results.session.recordedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

  return (
    <div className={`app ws ${state.companionOpen ? 'with-companion' : ''}`}>
      <AppBar
        actions={
          <>
            <SaveIndicator />
            <button className={`btn btn-companion ${state.companionOpen ? 'btn-on' : ''}`} onClick={() => dispatch({ type: 'toggleCompanion' })}>✦ Companion</button>
            <button className="btn btn-primary" onClick={() => dispatch({ type: 'setReflectOpen', open: true })}>Finish &amp; reflect</button>
            <SessionMenu onExport={exportAs} onDelete={() => setDeleting(true)} onHelp={() => setHelp(true)} />
          </>
        }
      >
        <nav className="crumbs" aria-label="Breadcrumb">
          <a href="#/">Home</a>
          <span>/</span>
          <b>{results.session.movement}</b>
          <span className="muted">{date}</span>
          {results.session.synthetic && <span className="pill pill-warn">Synthetic data</span>}
        </nav>
      </AppBar>
      <main className="ws-main">
        <GoalBar />
        <section className="ws-body">
          <StageArea />
          <Inspector />
        </section>
        <Timeline />
      </main>
      {state.companionOpen && <Companion />}
      <ReflectionSheet />
      <CommandPalette commands={commands} />
      <Onboarding open={help} onClose={() => setHelp(false)} />
      <DeleteDialog open={deleting} onClose={() => setDeleting(false)} />
    </div>
  )
}

export function Workspace({ id }: { id: string }) {
  const [results, setResults] = useState<SessionResults | null>(null)
  const [error, setError] = useState<ApiError | null>(null)

  useEffect(() => {
    let live = true
    setResults(null)
    api.getSessionResults(id).then(
      (r) => {
        if (!live) return
        if (!r.session.attemptsConfirmed || r.attempts.length === 0) return navigate({ name: 'confirm', id }, { replace: true })
        setResults(r)
        track('workspace.opened', { attempts: r.attempts.length })
      },
      (e) => {
        if (!live) return
        if (e instanceof ApiError && e.code === 'results_not_ready') return navigate({ name: 'processing', id }, { replace: true })
        setError(e instanceof ApiError ? e : new ApiError(0, 'network', 'Results aren’t available right now.'))
      },
    )
    return () => {
      live = false
      clock.pause()
    }
  }, [id])

  if (error) return <div className="app"><AppBar /><main className="main"><ErrorState title="This session didn’t open" message={error.message} action={<a className="btn" href="#/">Back to home</a>} /></main></div>
  if (!results) return <div className="app"><AppBar /><Spinner label="Loading session…" /></div>
  return (
    <StudioProvider key={id} results={results}>
      <Studio />
    </StudioProvider>
  )
}
