import { useState } from 'react'
import { ApiError, usingMockApi } from '../api/client'
import { signIn } from '../state/app'
import { toggleTheme, useTheme } from '../state/theme'
import { track } from '../study/log'
import { useDemoTrack } from '../lib/demoTrack'
import { PoseLoop } from '../components/PoseLoop'
import { BrandMark } from '../components/AppBar'

export function SignIn() {
  const demo = useDemoTrack()
  const theme = useTheme()
  // The study panel hands over the next participant's code as ?code=P08.
  const [code, setCode] = useState(() => new URLSearchParams(location.hash.split('?')[1] ?? '').get('code') ?? '')
  const [passcode, setPasscode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)

  const submit = async (as = { code, passcode }) => {
    setBusy(true)
    setError(null)
    try {
      await signIn(as.code, as.passcode)
      track('auth.signed_in')
    } catch (e) {
      track('auth.failed')
      setError(e instanceof ApiError ? e : new ApiError(0, 'network', 'Can’t reach the server right now.', 'Check your connection and try again.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="signin">
      <section className="signin-art" aria-hidden="true">
        <div className="signin-stage">
          {demo && <PoseLoop pose={demo.track.pose} fps={30} from={demo.attempt[0]} to={demo.attempt[1]} speed={0.8} />}
          <svg className="signin-guides" viewBox="0 0 100 100" preserveAspectRatio="none">
            <line x1="50" y1="6" x2="50" y2="91" />
          </svg>
          <span className="float-chip fc-1"><i className="swatch swatch-a" /> Attempt A</span>
          <span className="float-chip fc-2"><i className="swatch swatch-b" /> Attempt B, phase-matched</span>
          <span className="float-chip fc-3">Hold · 0:21.4</span>
        </div>
        <div className="signin-copy">
          <p className="kicker">Relevé balance in parallel</p>
          <h1>See your practice clearly.</h1>
          <p>Record a few attempts, check where each one starts, then look at your own movement side by side. You decide what it means, with your teacher.</p>
          <ul className="signin-features">
            <li><b>Video + pose, in sync</b><span>One clock drives the clip, skeleton and charts.</span></li>
            <li><b>Your attempts, side by side</b><span>B follows A phase by phase.</span></li>
            <li><b>Honest gaps</b><span>Missing tracking is shown, never filled in.</span></li>
          </ul>
        </div>
      </section>
      <section className="signin-panel">
        <div className="signin-top">
          <span className="brand"><span className="brand-mark"><BrandMark /></span><span className="brand-name">Practice Studio</span></span>
          <button className="icon-btn" onClick={toggleTheme} aria-label="Switch theme">{theme === 'dark' ? '☀' : '☾'}</button>
        </div>
        <form
          className="signin-form"
          onSubmit={(e) => {
            e.preventDefault()
            submit()
          }}
        >
          <h2>Sign in</h2>
          <p className="muted">Use the participant code from your study facilitator. Your name is never stored with your practice data.</p>
          <label className="field">
            <span>Participant code</span>
            <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="P07" autoComplete="username" autoFocus required spellCheck={false} />
          </label>
          <label className="field">
            <span>Passcode</span>
            <input value={passcode} onChange={(e) => setPasscode(e.target.value)} type="password" autoComplete="current-password" required />
          </label>
          {error && (
            <p className="form-error" role="alert">
              {error.message} {error.recovery}
            </p>
          )}
          <button className="btn btn-primary btn-lg" disabled={busy || !code || !passcode}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
          {usingMockApi && (
            <>
              <div className="or"><span>or</span></div>
              <button type="button" className="btn btn-lg btn-demo" disabled={busy} onClick={() => submit({ code: 'P07', passcode: 'practice' })}>
                ▶ Explore the demo
              </button>
            </>
          )}
          {usingMockApi && (
            <p className="dev-hint">
              Prototype: any code like <code>P07</code> with passcode <code>practice</code>. Everything shown is synthetic.
            </p>
          )}
        </form>
        <p className="signin-foot">CS 4850 · Team 2 · MT-1 HCI. A practice aid, not a grading tool.</p>
      </section>
    </div>
  )
}
