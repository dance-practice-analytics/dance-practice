// Pose import and processing (Development Document 1.4, 1.7, 2.3.2): upload the
// pose export, follow the job, and read the import report before confirming attempts.

import { useCallback, useEffect, useRef, useState } from 'react'
import type { Job, SessionSummary } from '../types'
import { api, ApiError, usingMockApi } from '../api/client'
import { navigate } from '../router'
import { formatTime } from '../lib/format'
import { useDemoTrack } from '../lib/demoTrack'
import { AppBar } from '../components/AppBar'
import { PoseLoop } from '../components/PoseLoop'
import { ErrorState, Spinner } from '../components/ui'
import { track } from '../study/log'

const STAGES = [
  'Checking the export format and fields',
  'Matching the export to your clip at the start, middle and end',
  'Converting landmarks to body coordinates',
  'Calculating measurements',
]

function QualityStrip({ job, duration }: { job: Job; duration: number }) {
  const r = job.report!
  return (
    <div className="quality-strip" role="img" aria-label={`Tracking quality across the clip: ${Math.round(r.coverage * 100)}% usable`}>
      <div className="qs-bar">
        {r.gaps.map((g) => (
          <span key={`${g.kind}${g.from}`} className={`tl-q tl-q-${g.kind}`} style={{ left: `${(g.from / duration) * 100}%`, width: `${Math.max(0.6, ((g.to - g.from) / duration) * 100)}%` }} />
        ))}
      </div>
      <div className="qs-axis">
        <span>0:00</span>
        <span>{formatTime(duration)}</span>
      </div>
    </div>
  )
}

export function Processing({ id }: { id: string }) {
  const demo = useDemoTrack()
  const [session, setSession] = useState<SessionSummary | null>(null)
  const [job, setJob] = useState<Job | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const poll = useRef(0)

  const follow = useCallback((jobId: string) => {
    window.clearTimeout(poll.current)
    const tick = async () => {
      try {
        const j = await api.getJob(jobId)
        setJob(j)
        if (j.state === 'queued' || j.state === 'processing') poll.current = window.setTimeout(tick, 450)
        else track('processing.job_end', { state: j.state, code: j.error?.code ?? null })
      } catch {
        poll.current = window.setTimeout(tick, 2000)
      }
    }
    tick()
  }, [])

  useEffect(() => {
    let live = true
    api.listSessions().then(
      (list) => {
        if (!live) return
        const s = list.find((x) => x.id === id)
        if (!s) return setLoadError('This session no longer exists.')
        if (s.status === 'ready') return navigate({ name: 'workspace', id }, { replace: true })
        setSession(s)
        if (s.jobId) follow(s.jobId)
      },
      (e) => live && setLoadError(e instanceof ApiError ? e.message : 'Couldn’t load this session.'),
    )
    return () => {
      live = false
      window.clearTimeout(poll.current)
    }
  }, [id, follow])

  const upload = async (file: File | null, scenario?: 'mismatch') => {
    if (file && !file.name.toLowerCase().endsWith('.json')) {
      setUploadError('The pose export should be a .json file.')
      return
    }
    setBusy(true)
    setUploadError(null)
    try {
      const j = await api.uploadPose(id, file, scenario)
      track('processing.pose_uploaded', { scenario: scenario ?? 'ok' })
      setJob(j)
      follow(j.id)
    } catch (e) {
      setUploadError(e instanceof ApiError ? `${e.message} ${e.recovery ?? ''}` : 'The upload didn’t go through. Try again.')
    } finally {
      setBusy(false)
    }
  }

  if (loadError) return <div className="app"><AppBar /><main className="main"><ErrorState title="Can’t open this session" message={loadError} action={<a className="btn" href="#/">Back to home</a>} /></main></div>
  if (!session) return <div className="app"><AppBar /><Spinner label="Loading session…" /></div>

  const running = job && (job.state === 'queued' || job.state === 'processing')
  const failed = job && (job.state === 'failed' || job.state === 'interrupted')
  const done = job?.state === 'complete'
  const stageIndex = job ? STAGES.indexOf(job.stage) : -1
  const date = new Date(session.recordedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

  return (
    <div className="app">
      <AppBar>
        <nav className="crumbs" aria-label="Breadcrumb"><a href="#/">Home</a><span>/</span><b>{date} session</b></nav>
      </AppBar>
      <main className="main processing">
        <section className="proc-stage" aria-hidden="true">
          {demo && <PoseLoop pose={demo.track.pose} fps={30} from={demo.hold[0]} to={demo.hold[1]} reveal={done ? 1 : running ? 0.15 + job!.progress * 0.85 : 0.08} speed={0.6} />}
          <span className="proc-caption">{done ? 'Pose ready' : running ? `${Math.round(job!.progress * 100)}%` : failed ? 'Stopped' : 'Waiting for pose data'}</span>
        </section>

        <section className="proc-panel">
          <p className="kicker">“{session.goal}”</p>
          {!job && (
            <>
              <h1>Add the pose data</h1>
              <p className="muted">Your clip is saved. Run it through the pose software, then upload the export it produces (JSON). The export must come from this exact clip, untrimmed.</p>
              <label className="dropzone small">
                <input type="file" accept=".json,application/json" className="sr-only" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} disabled={busy} />
                <b>{busy ? 'Uploading…' : 'Choose the pose export (.json)'}</b>
              </label>
              {usingMockApi && (
                <div className="sample-actions">
                  <button className="btn btn-primary" onClick={() => upload(null)} disabled={busy}>Use the synthetic export</button>
                  <button className="link-btn" onClick={() => upload(null, 'mismatch')} disabled={busy} title="For testing the error message">Try a mismatched export</button>
                </div>
              )}
              {uploadError && <p className="form-error" role="alert">{uploadError}</p>}
            </>
          )}

          {job && (
            <>
              <h1>{done ? 'Your measurements are ready' : failed ? 'This export couldn’t be used' : 'Reading your movement…'}</h1>
              <ol className="stages">
                {STAGES.map((s, i) => {
                  const state = done || i < stageIndex ? 'done' : i === stageIndex ? (failed ? 'failed' : 'active') : 'todo'
                  return (
                    <li key={s} className={`stage-${state}`}>
                      <span className="stage-mark" aria-hidden="true">{state === 'done' ? '✓' : state === 'failed' ? '!' : ''}</span>
                      {s}
                    </li>
                  )
                })}
              </ol>
              {job.state === 'queued' && <p className="muted small">Waiting for a worker…</p>}
              {failed && job.error && (
                <div className="proc-error" role="alert">
                  <p><b>{job.error.message}</b></p>
                  <p>{job.error.recovery}</p>
                  <button className="btn" onClick={() => setJob(null)}>Upload another export</button>
                </div>
              )}
              {done && job.report && (
                <div className="report">
                  <div className="report-stats">
                    <div><b>{job.report.frames.toLocaleString()}</b><span>frames read</span></div>
                    <div><b>{Math.round(job.report.coverage * 100)}%</b><span>with a usable pose</span></div>
                    <div><b>{job.report.gaps.length}</b><span>{job.report.gaps.length === 1 ? 'gap' : 'gaps'} in tracking</span></div>
                  </div>
                  <QualityStrip job={job} duration={session.media?.duration ?? 39} />
                  {job.report.warnings.length > 0 && (
                    <ul className="report-warnings">
                      {job.report.warnings.map((w) => <li key={w}>{w}</li>)}
                    </ul>
                  )}
                  <p className="muted small">Gaps aren’t filled in or guessed. Measurements there are shown as missing, so you can see exactly what the camera caught.</p>
                  <button className="btn btn-primary btn-lg" onClick={() => navigate({ name: 'confirm', id }, { replace: true })}>Next: confirm your attempts →</button>
                </div>
              )}
            </>
          )}
        </section>
      </main>
    </div>
  )
}
