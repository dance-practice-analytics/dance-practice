// Create a session: goal, recording conditions, the clip and the permission check
// (Development Document 1.3). The server re-checks everything with FFprobe; the
// browser check only catches obvious problems early.

import { useEffect, useState } from 'react'
import type { CameraDistance, CameraView, Fatigue, RecordingConditions } from '../types'
import { api, ApiError, usingMockApi } from '../api/client'
import { navigate } from '../router'
import { AppBar } from '../components/AppBar'
import { track } from '../study/log'

const GOALS = ['Keep my knees over my toes as I rise', 'Keep my shoulders down, away from my ears', 'Stay vertical through the hold', 'Hold the top a little longer']

const FORMATS = ['video/mp4', 'video/quicktime', 'video/webm']
const MAX_BYTES = 500 * 1024 * 1024
const MAX_SECONDS = 180

interface ClipCheck {
  file: File
  url: string
  duration: number | null
  width: number | null
  height: number | null
  problems: string[]
}

function checkClip(file: File): Promise<ClipCheck> {
  const url = URL.createObjectURL(file)
  const problems: string[] = []
  if (!FORMATS.includes(file.type)) problems.push('This format isn’t supported. Use MP4, MOV or WebM.')
  if (file.size > MAX_BYTES) problems.push(`The file is ${(file.size / 1024 / 1024).toFixed(0)} MB. The limit is 500 MB; trim it to just the attempts.`)
  return new Promise((resolve) => {
    const v = document.createElement('video')
    v.preload = 'metadata'
    v.onloadedmetadata = () => {
      if (v.duration > MAX_SECONDS) problems.push(`The clip is ${Math.round(v.duration)} s long. Keep it under 3 minutes.`)
      resolve({ file, url, duration: v.duration, width: v.videoWidth, height: v.videoHeight, problems })
    }
    v.onerror = () => resolve({ file, url, duration: null, width: null, height: null, problems: [...problems, 'This browser can’t read the clip. It may be damaged or use an unusual codec.'] })
    v.src = url
  })
}

function Choice<T extends string | boolean>({ label, value, options, onChange }: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="choice" role="radiogroup" aria-label={label}>
      <span className="choice-label">{label}</span>
      <div className="seg">
        {options.map(([v, text]) => (
          <button key={String(v)} type="button" role="radio" aria-checked={value === v} className={`seg-btn ${value === v ? 'on' : ''}`} onClick={() => onChange(v)}>
            {text}
          </button>
        ))}
      </div>
    </div>
  )
}

/** Framing guide: where the dancer should be in a vertical phone frame. */
function FramingGuide() {
  return (
    <svg className="framing" viewBox="0 0 120 200" aria-label="Framing guide: phone upright, whole body in frame from head to toes, facing the camera">
      <rect x="4" y="4" width="112" height="192" rx="16" className="fr-phone" />
      <rect x="12" y="16" width="96" height="168" rx="6" className="fr-screen" />
      <line x1="12" y1="158" x2="108" y2="158" className="fr-floor" />
      <rect x="40" y="30" width="40" height="132" rx="6" className="fr-safe" />
      <g className="fr-body">
        <circle cx="60" cy="44" r="7" />
        <path d="M60 51v42M48 58l12 4 12-4M48 58l-4 22M72 58l4 22M55 93l-1 31 1 32M65 93l1 31-1 32" />
      </g>
      <text x="60" y="24" textAnchor="middle" className="fr-note">head room</text>
      <text x="60" y="176" textAnchor="middle" className="fr-note">feet visible</text>
    </svg>
  )
}

const STEPS = ['Goal', 'Recording', 'Clip'] as const

export function NewSession() {
  const [step, setStep] = useState(0)
  const [goal, setGoal] = useState('')
  const [conditions, setConditions] = useState<RecordingConditions>({ view: 'front', distance: 'medium', music: false, fatigue: 'fresh' })
  const [clip, setClip] = useState<ClipCheck | null>(null)
  const [useSample, setUseSample] = useState(usingMockApi)
  const [permission, setPermission] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const [dragging, setDragging] = useState(false)

  useEffect(() => () => {
    if (clip) URL.revokeObjectURL(clip.url)
  }, [clip])

  const set = <K extends keyof RecordingConditions>(k: K) => (v: RecordingConditions[K]) => setConditions((c) => ({ ...c, [k]: v }))

  const pick = async (file: File | undefined) => {
    if (!file) return
    setUseSample(false)
    const c = await checkClip(file)
    setClip(c)
    track('new.clip_checked', { ok: c.problems.length === 0, seconds: c.duration && Math.round(c.duration) })
  }

  const clipOk = useSample || (clip !== null && clip.problems.length === 0)
  const canGo = [goal.trim().length > 0, true, clipOk && permission][step]

  const create = async () => {
    setBusy(true)
    setError(null)
    try {
      const s = await api.createSession({ movement: 'releve-parallel', goal, conditions, permissionConfirmed: true, useSample }, useSample ? null : clip!.file)
      track('new.created', { view: conditions.view, sample: useSample })
      navigate({ name: 'processing', id: s.id }, { replace: true })
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError(0, 'network', 'The upload didn’t go through.', 'Check your connection and try again.'))
      setBusy(false)
    }
  }

  return (
    <div className="app">
      <AppBar>
        <nav className="crumbs" aria-label="Breadcrumb"><a href="#/">Home</a><span>/</span><b>New session</b></nav>
      </AppBar>
      <main className="main wizard">
        <ol className="stepper">
          {STEPS.map((s, i) => (
            <li key={s} className={i === step ? 'on' : i < step ? 'done' : ''}>
              <button disabled={i > step} onClick={() => setStep(i)}><span>{i < step ? '✓' : i + 1}</span>{s}</button>
            </li>
          ))}
        </ol>

        {step === 0 && (
          <section className="wizard-card">
            <p className="kicker">Step 1 of 3</p>
            <h1>What are you practicing today?</h1>
            <div className="movement-pick">
              <button className="movement on" type="button" aria-pressed="true">
                <b>Relevé balance in parallel</b>
                <span>Plié, rise to relevé, hold, lower. Feet parallel, facing the camera.</span>
              </button>
              <div className="movement off" aria-disabled="true">
                <b>More movements</b>
                <span>Added after the pilot.</span>
              </div>
            </div>
            <label className="field field-goal">
              <span>Your goal for this session, in your own words</span>
              <input value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="e.g. Keep my knees over my toes as I rise" autoFocus />
            </label>
            <div className="goal-ideas">
              <span className="muted">Ideas:</span>
              {GOALS.map((g) => (
                <button key={g} type="button" className="suggestion" onClick={() => setGoal(g)}>{g}</button>
              ))}
            </div>
          </section>
        )}

        {step === 1 && (
          <section className="wizard-card wizard-split">
            <div>
              <p className="kicker">Step 2 of 3</p>
              <h1>Set up the camera</h1>
              <ul className="checklist">
                <li><b>Front view</b>, facing the camera, phone upright at hip height.</li>
                <li><b>Whole body</b> in frame, with room above your head and your feet visible.</li>
                <li><b>3–4 m away</b>, phone steady on a stand or shelf, not handheld.</li>
                <li><b>Even light</b> from the front or side, not a bright window behind you.</li>
                <li><b>Only you</b> in the frame, in fitted clothing so knees and ankles show.</li>
                <li><b>3–5 attempts</b> with a short pause standing between each one.</li>
              </ul>
              <h2 className="sub">How was this clip recorded?</h2>
              <p className="muted small">This changes what the measurements can show, so attempts filmed differently aren’t compared directly.</p>
              <div className="choices">
                <Choice<CameraView> label="Camera view" value={conditions.view} onChange={set('view')} options={[['front', 'Front'], ['side', 'Side'], ['mirror', 'Through a mirror']]} />
                <Choice<CameraDistance> label="Distance" value={conditions.distance} onChange={set('distance')} options={[['close', 'Under 2 m'], ['medium', '2–4 m'], ['far', 'Over 4 m']]} />
                <Choice<boolean> label="Music" value={conditions.music} onChange={set('music')} options={[[false, 'No music'], [true, 'With music']]} />
                <Choice<Fatigue> label="How you felt" value={conditions.fatigue} onChange={set('fatigue')} options={[['fresh', 'Fresh'], ['some', 'A bit tired'], ['tired', 'Tired']]} />
              </div>
              {conditions.view !== 'front' && <p className="cmp-note warn">The measurements are designed for a front view. Side and mirror clips are kept, but are flagged and not compared with front-view sessions.</p>}
            </div>
            <FramingGuide />
          </section>
        )}

        {step === 2 && (
          <section className="wizard-card">
            <p className="kicker">Step 3 of 3</p>
            <h1>Add your clip</h1>
            <label
              className={`dropzone ${dragging ? 'over' : ''} ${clip && !useSample ? 'has-file' : ''}`}
              onDragOver={(e) => {
                e.preventDefault()
                setDragging(true)
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault()
                setDragging(false)
                pick(e.dataTransfer.files[0])
              }}
            >
              <input type="file" accept={FORMATS.join(',')} onChange={(e) => pick(e.target.files?.[0])} className="sr-only" />
              {clip && !useSample ? (
                <div className="clip-preview">
                  <video src={clip.url} muted playsInline controls={false} />
                  <div>
                    <b>{clip.file.name}</b>
                    <span>
                      {clip.duration ? `${clip.duration.toFixed(1)} s` : 'unknown length'}
                      {clip.width ? ` · ${clip.width}×${clip.height}` : ''} · {(clip.file.size / 1024 / 1024).toFixed(1)} MB
                    </span>
                    {clip.problems.length === 0 ? <span className="ok">✓ Looks readable. The server will check it again.</span> : clip.problems.map((p) => <span key={p} className="form-error">{p}</span>)}
                    <span className="link-btn">Choose a different clip</span>
                  </div>
                </div>
              ) : (
                <>
                  <b>Drop a video here, or click to choose one</b>
                  <span className="muted">MP4, MOV or WebM · up to 3 minutes · up to 500 MB</span>
                </>
              )}
            </label>
            {usingMockApi && (
              <label className={`sample ${useSample ? 'on' : ''}`}>
                <input type="radio" checked={useSample} onChange={() => setUseSample(true)} />
                <span>
                  <b>Use the synthetic sample clip</b>
                  <small>Prototype only: no backend is connected, so the measurements always come from synthetic data. A file you choose stays on this device.</small>
                </span>
              </label>
            )}
            <label className="consent">
              <input type="checkbox" checked={permission} onChange={(e) => setPermission(e.target.checked)} />
              <span>I have permission to use this footage for my practice, and everyone who appears in it agreed to be recorded.</span>
            </label>
            {error && <p className="form-error" role="alert">{error.message} {error.recovery}</p>}
          </section>
        )}

        <div className="wizard-nav">
          {step > 0 ? <button className="btn" onClick={() => setStep(step - 1)}>← Back</button> : <a className="btn" href="#/">Cancel</a>}
          {step < STEPS.length - 1 ? (
            <button className="btn btn-primary" disabled={!canGo} onClick={() => setStep(step + 1)}>Continue →</button>
          ) : (
            <button className="btn btn-primary" disabled={!canGo || busy} onClick={create}>{busy ? 'Uploading…' : 'Create session →'}</button>
          )}
        </div>
      </main>
    </div>
  )
}
