// Facilitator panel for usability sessions: task script, timing and outcome,
// a JSON export of the event log, and a reset between participants so every
// run starts from the same state. Toggle with Ctrl+Shift+S.

import { useEffect, useState } from 'react'
import { download, usingMockApi } from '../api/client'
import { useStore } from '../state/store'
import { auth, signOut, toast } from '../state/app'
import { resetOnboarding } from '../components/Onboarding'
import { navigate } from '../router'
import { clearStudyLog, endTask, markStudyLogExported, setStudyEnabled, startTask, study, studyLogJson, TASKS, toggleStudyPanel } from './log'

function Elapsed({ since }: { since: number }) {
  const [, tick] = useState(0)
  useEffect(() => {
    const id = window.setInterval(() => tick((n) => n + 1), 1000)
    return () => window.clearInterval(id)
  }, [])
  const s = Math.floor((Date.now() - since) / 1000)
  return <span className="study-timer">{Math.floor(s / 60)}:{String(s % 60).padStart(2, '0')}</span>
}

function exportLog() {
  const s = study.get()
  download(new Blob([studyLogJson()], { type: 'application/json' }), `dad-usability-${s.participant ?? 'unknown'}-${new Date().toISOString().slice(0, 16).replace(':', '')}.json`)
  markStudyLogExported()
}

/** Between participants: export, then wipe the log, the mock sessions and the onboarding flag, and sign out. */
function NextParticipant({ onDone }: { onDone: () => void }) {
  const s = useStore(study)
  const [code, setCode] = useState(() => {
    const n = Number(s.participant?.slice(1))
    return Number.isFinite(n) && n > 0 ? `P${String(n + 1).padStart(2, '0')}` : ''
  })
  const [discard, setDiscard] = useState(false)
  const [busy, setBusy] = useState(false)
  const unsaved = s.events.length > 0 && s.exportedCount !== s.events.length
  const valid = /^P\d{2,3}$/.test(code)

  const reset = async () => {
    setBusy(true)
    // Leave the current screen first so any pending autosave lands before the data is wiped.
    navigate({ name: 'journal' })
    await new Promise((r) => setTimeout(r, 900))
    if (usingMockApi) await import('../mock/server').then((m) => m.resetMockData())
    clearStudyLog()
    resetOnboarding()
    history.replaceState(null, '', `#/signin?code=${code}`)
    await signOut()
    toast(`Ready for ${code}. Sessions, log and onboarding are reset.`)
    setBusy(false)
    onDone()
  }

  return (
    <div className="study-next">
      <p><b>Next participant</b></p>
      <label className="study-field">
        <span>Code</span>
        <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase().trim())} placeholder="P08" spellCheck={false} />
      </label>
      <ul className="study-checks">
        <li className={unsaved ? 'warn' : 'ok'}>{unsaved ? `Log has ${s.events.length - (s.exportedCount ?? 0)} events not exported` : s.events.length ? 'Log exported' : 'Log is empty'}</li>
        <li className="ok">{usingMockApi ? 'Mock sessions go back to the same seeded history' : 'Real API: sessions are not reset from here'}</li>
        <li className="ok">Onboarding cards show again</li>
      </ul>
      {unsaved && (
        <div className="study-row">
          <button className="btn btn-sm" onClick={exportLog}>Export log first</button>
          <label className="study-discard"><input type="checkbox" checked={discard} onChange={(e) => setDiscard(e.target.checked)} /> Discard it</label>
        </div>
      )}
      <div className="study-row">
        <button className="btn btn-sm" onClick={onDone}>Cancel</button>
        <button className="btn btn-sm btn-primary" disabled={!valid || busy || (unsaved && !discard)} onClick={reset}>{busy ? 'Resetting…' : `Reset for ${valid ? code : '…'}`}</button>
      </div>
    </div>
  )
}

export function StudyPanel() {
  const s = useStore(study)
  const a = useStore(auth)
  const [next, setNext] = useState(false)
  if (!s.enabled || !s.panelOpen) return null
  const current = TASKS.find((t) => t.id === s.task)
  const done = new Set(s.events.filter((e) => e.type === 'task_end').map((e) => e.detail?.task))
  const unsaved = s.events.length > 0 && s.exportedCount !== s.events.length

  return (
    <aside className="study-panel" aria-label="Usability study panel">
      <header>
        <div>
          <b><span className="rec-dot" /> Study log</b>
          <small>
            {s.participant ?? (a.status === 'signedIn' ? a.account.participant : 'waiting for sign-in')} · {done.size}/{TASKS.length} tasks · {s.events.length} events
            {s.events.length > 0 && s.startedAt && <> · <Elapsed since={s.startedAt} /></>}
          </small>
        </div>
        <button className="icon-btn small" onClick={toggleStudyPanel} aria-label="Hide study panel" title="Hide (Ctrl+Shift+S)">–</button>
      </header>
      {next ? (
        <NextParticipant onDone={() => setNext(false)} />
      ) : current ? (
        <div className="study-current">
          <small>{current.id} · {current.title} {s.taskStartedAt && <Elapsed since={s.taskStartedAt} />}</small>
          <p>{current.prompt}</p>
          <div className="seg">
            <button className="seg-btn" onClick={() => endTask('completed')}>Completed</button>
            <button className="seg-btn" onClick={() => endTask('assisted')}>With help</button>
            <button className="seg-btn" onClick={() => endTask('abandoned')}>Gave up</button>
          </div>
        </div>
      ) : (
        <ol className="study-tasks">
          {TASKS.map((t) => (
            <li key={t.id}>
              <button onClick={() => startTask(t.id)} title={t.prompt}>
                <span>{done.has(t.id) ? '✓' : t.id}</span>
                {t.title}
              </button>
            </li>
          ))}
        </ol>
      )}
      {!next && (
        <footer>
          <button className="link-btn" onClick={exportLog}>Export log{unsaved ? ' •' : ''}</button>
          <button className="link-btn" onClick={() => setNext(true)}>Next participant…</button>
          <button className="link-btn" onClick={() => setStudyEnabled(false)}>Turn off</button>
        </footer>
      )}
      <p className="study-note">Stored only in this browser, by participant code. No notes or free text are recorded. Usability only, separate from measurement accuracy.</p>
    </aside>
  )
}
