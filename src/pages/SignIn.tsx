import { useState } from 'react'
import { ApiError, usingMockApi, usingSupabaseAuth } from '../api/client'
import { MIN_PASSWORD } from '../api/authErrors'
import { signIn, signUp } from '../state/app'
import { toggleTheme, useTheme } from '../state/theme'
import { track } from '../study/log'
import { useDemoTrack } from '../lib/demoTrack'
import { PoseLoop } from '../components/PoseLoop'
import { BrandMark } from '../components/AppBar'

type Mode = 'signin' | 'signup'

const ICON = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.75, strokeLinecap: 'round', strokeLinejoin: 'round' } as const

/**
 * Screen 1 of the MT-2 design. With Supabase configured it is email + password
 * (FR-3.1.1, 3.1.2); on the mock alone it keeps the participant code + passcode.
 */
export function SignIn() {
  const demo = useDemoTrack()
  const theme = useTheme()
  const [mode, setMode] = useState<Mode>('signin')
  // The study panel hands over the next participant's code as ?code=P08.
  const [id, setId] = useState(() => (usingSupabaseAuth ? '' : new URLSearchParams(location.hash.split('?')[1] ?? '').get('code') ?? ''))
  const [secret, setSecret] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const creating = usingSupabaseAuth && mode === 'signup'

  const submit = async (as = { id, secret }) => {
    setBusy(true)
    setError(null)
    try {
      if (creating) {
        await signUp(as.id, as.secret)
        track('auth.signed_up')
      } else {
        await signIn(as.id, as.secret)
        track('auth.signed_in')
      }
    } catch (e) {
      track('auth.failed')
      setError(e instanceof ApiError ? e : new ApiError(0, 'network', 'Can’t reach the server right now.', 'Check your connection and try again.'))
    } finally {
      setBusy(false)
    }
  }

  const pick = (next: Mode) => {
    setMode(next)
    setError(null)
  }

  return (
    <div className="signin">
      <section className="signin-panel">
        <div className="signin-top">
          <span className="brand"><span className="brand-mark"><BrandMark /></span><span className="brand-name">Dance Practice Analytics</span></span>
          <button className="icon-btn" onClick={toggleTheme} aria-label="Switch theme">{theme === 'dark' ? '☀' : '☾'}</button>
        </div>
        <form
          className="signin-form"
          onSubmit={(e) => {
            e.preventDefault()
            submit()
          }}
        >
          <div className="signin-head">
            <h1>{creating ? 'Create your account' : 'Welcome back'}</h1>
            <p className="muted">Review your practice clips, one movement at a time.</p>
          </div>
          {usingSupabaseAuth && (
            <div className="auth-tabs" role="tablist" aria-label="Account">
              <button type="button" role="tab" aria-selected={mode === 'signin'} className={mode === 'signin' ? 'on' : ''} onClick={() => pick('signin')}>Sign in</button>
              <button type="button" role="tab" aria-selected={mode === 'signup'} className={mode === 'signup' ? 'on' : ''} onClick={() => pick('signup')}>Create account</button>
            </div>
          )}
          {usingSupabaseAuth ? (
            <>
              <label className="field">
                <span>Email</span>
                <input value={id} onChange={(e) => setId(e.target.value)} type="email" autoComplete="email" placeholder="you@students.kennesaw.edu" autoFocus required spellCheck={false} />
              </label>
              <label className="field">
                <span>Password</span>
                <input
                  value={secret}
                  onChange={(e) => setSecret(e.target.value)}
                  type="password"
                  autoComplete={creating ? 'new-password' : 'current-password'}
                  minLength={creating ? MIN_PASSWORD : undefined}
                  aria-describedby={creating ? 'signin-pw-hint' : undefined}
                  required
                />
                {creating && <small className="field-hint" id="signin-pw-hint">At least {MIN_PASSWORD} characters.</small>}
              </label>
            </>
          ) : (
            <>
              <label className="field">
                <span>Participant code</span>
                <input value={id} onChange={(e) => setId(e.target.value)} placeholder="P07" autoComplete="username" autoFocus required spellCheck={false} />
              </label>
              <label className="field">
                <span>Passcode</span>
                <input value={secret} onChange={(e) => setSecret(e.target.value)} type="password" autoComplete="current-password" required />
              </label>
            </>
          )}
          {error && (
            <p className="form-error" role="alert">
              {error.message} {error.recovery}
            </p>
          )}
          <button className="btn btn-primary btn-lg" disabled={busy || !id || !secret}>
            {creating ? (busy ? 'Creating account…' : 'Create account') : busy ? 'Signing in…' : 'Sign in'}
          </button>
          {!usingSupabaseAuth && usingMockApi && (
            <>
              <div className="or"><span>or</span></div>
              <button type="button" className="btn btn-lg btn-demo" disabled={busy} onClick={() => submit({ id: 'P07', secret: 'practice' })}>
                ▶ Explore the demo
              </button>
              <p className="dev-hint">
                Prototype: any code like <code>P07</code> with passcode <code>practice</code>. Everything shown is synthetic.
              </p>
            </>
          )}
          {usingSupabaseAuth && (
            <p className="signin-note">
              {creating
                ? 'Next: choose what is stored. Nothing is uploaded until you say so.'
                : 'Study participants: use the email your researcher invited. You’ll only appear in the study as a code (S01–S12).'}
            </p>
          )}
        </form>
        <p className="signin-foot">KSU CS 4850 capstone · Team MT-2-HCI. A practice aid, not a grading tool.</p>
      </section>
      <section className="signin-art">
        <div className="signin-stage" aria-hidden="true">
          {demo && <PoseLoop pose={demo.track.pose} fps={30} from={demo.attempt[0]} to={demo.attempt[1]} speed={0.8} />}
          <svg className="signin-guides" viewBox="0 0 100 100" preserveAspectRatio="none">
            <line x1="50" y1="6" x2="50" y2="91" />
          </svg>
          <span className="float-chip fc-1"><i className="swatch swatch-a" /> Attempt A</span>
          <span className="float-chip fc-2"><i className="swatch swatch-b" /> Attempt B, phase-matched</span>
          <span className="float-chip fc-3">Hold · 0:21.4</span>
        </div>
        <div className="signin-copy">
          <h2>Your video stays with you.</h2>
          <ul className="signin-points">
            <li>
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" {...ICON}><path d="M7 3h10v18H7zM11 18h2" /></svg>
              Pose estimation runs on this device. Study clips are never uploaded.
            </li>
            <li>
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" {...ICON}><path d="M6 11h12v10H6zM8 11V7a4 4 0 0 1 8 0v4" /></svg>
              Only keypoints and metrics are saved to your account.
            </li>
            <li>
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" {...ICON}><path d="M6 3h9l4 4v14H6zM9 12h7M9 16h5" /></svg>
              Practice notes are written from numbers, not images.
            </li>
          </ul>
        </div>
      </section>
    </div>
  )
}
