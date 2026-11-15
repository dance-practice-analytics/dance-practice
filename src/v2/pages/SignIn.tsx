// Screen 1 — sign in / create account.
// Design: SignIn.dc.html (wide: form + dark "Your video stays with you" panel) and
// SignInMobile.dc.html (stage on top, form below). One responsive component.
// Left out on purpose: "Forgot password?" and the email sign-in link — both need
// outgoing email, which is rate-limited on this project; no dead controls.

import { useState, type FormEvent } from 'react'
import { MIN_PASSWORD } from '../../api/authErrors'
import { ApiError } from '../../api/errors'
import { signIn, signUp } from '../auth'
import { Icon, Logo, Spinner, type IconName } from '../components'
import { useIsNarrow } from '../useIsNarrow'

type Mode = 'signin' | 'signup'

const POINTS: { icon: IconName; text: string }[] = [
  { icon: 'device', text: 'Pose estimation runs on this device. Study clips are never uploaded.' },
  { icon: 'lock', text: 'Only keypoints and metrics are saved to your account.' },
  { icon: 'notes', text: 'Practice notes are written from numbers, not images.' },
]

/**
 * The decorative figure of the design (VideoStage with chrome off). It is an
 * illustration, not pose data, so it lives here and is hidden from assistive tech;
 * the real VideoStage only ever draws tracked landmarks.
 */
function StageArt() {
  const bone = '#F3F1EC'
  return (
    <div
      aria-hidden="true"
      style={{ position: 'relative', width: '100%', aspectRatio: '16 / 9', background: '#1E1D1B', borderRadius: 12, overflow: 'hidden' }}
    >
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: '24%', background: '#2A2825' }} />
      <div style={{ position: 'absolute', left: 0, right: 0, top: '47%', height: 3, background: '#34312D' }} />
      <svg viewBox="0 0 200 300" style={{ position: 'absolute', top: '5%', height: '90%', left: '50%', transform: 'translateX(-50%)' }}>
        <line x1="101" y1="262" x2="101" y2="10" stroke="rgba(243,241,236,.38)" strokeWidth="1" strokeDasharray="3 4" />
        <g transform="rotate(2.4 101 254)" fill="none" strokeLinecap="round" strokeLinejoin="round" stroke={bone} strokeWidth="2.25">
          <circle cx="100" cy="32" r="12" />
          <polyline points="84,62 116,62" />
          <polyline points="84,62 70,92 86,118" />
          <polyline points="116,62 130,92 114,118" />
          <polyline points="100,54 100,140" stroke="#A9BCF2" strokeWidth="3.5" />
          <polyline points="90,140 110,140" />
          <polyline points="96,140 99,198 101,254" />
          <polyline points="101,254 104,272" />
          <polyline points="106,140 140,178 104,196" />
          <g fill={bone} stroke="none">
            {[
              [100, 54], [84, 62], [116, 62], [70, 92], [130, 92], [86, 118], [114, 118],
              [90, 140], [110, 140], [140, 178], [104, 196], [101, 254], [104, 272], [99, 198],
            ].map(([cx, cy]) => (
              <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="3.5" />
            ))}
          </g>
        </g>
      </svg>
    </div>
  )
}

export function SignIn() {
  const narrow = useIsNarrow()
  const [mode, setMode] = useState<Mode>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const signup = mode === 'signup'
  const tooShort = signup && password.length > 0 && password.length < MIN_PASSWORD

  const pick = (next: Mode) => {
    setMode(next)
    setError(null)
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    if (signup && password.length < MIN_PASSWORD) {
      setError(new ApiError(422, 'weak_password', 'That password is too short.', `Use at least ${MIN_PASSWORD} characters.`))
      return
    }
    setBusy(true)
    setError(null)
    try {
      await (signup ? signUp(email, password) : signIn(email, password))
      // The auth store now shows the consent screen or the app.
    } catch (err) {
      setError(err as ApiError)
      setBusy(false)
    }
  }

  const brand = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <Logo />
      <span className="t-h3">Dance Practice Analytics</span>
    </div>
  )

  const form = (
    <form onSubmit={submit} noValidate style={{ width: '100%', maxWidth: narrow ? undefined : 400, display: 'flex', flexDirection: 'column', gap: narrow ? 16 : 20 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <h1 className="t-h1">{signup ? 'Create your account' : 'Welcome back'}</h1>
        {!narrow && <p className="muted">Review your practice clips, one movement at a time.</p>}
      </div>
      <div className="seg" role="tablist" aria-label="Account" style={{ width: '100%' }}>
        {(['signin', 'signup'] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            className={mode === m ? 'on' : undefined}
            style={{ flex: 1, justifyContent: 'center', height: narrow ? 40 : undefined }}
            onClick={() => pick(m)}
          >
            {m === 'signin' ? 'Sign in' : 'Create account'}
          </button>
        ))}
      </div>
      <div className="field">
        <label className="field-label" htmlFor="si-email">
          Email
        </label>
        <input
          className="input"
          id="si-email"
          type="email"
          autoComplete="email"
          placeholder="you@students.kennesaw.edu"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>
      <div className={tooShort ? 'field has-error' : 'field'}>
        <label className="field-label" htmlFor="si-pw">
          Password
        </label>
        <input
          className="input"
          id="si-pw"
          type="password"
          autoComplete={signup ? 'new-password' : 'current-password'}
          aria-describedby={signup ? 'si-pw-hint' : undefined}
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {signup && (
          <span className="hint" id="si-pw-hint">
            At least {MIN_PASSWORD} characters.
          </span>
        )}
      </div>
      {error && (
        <p className="err-msg" role="alert" style={{ alignItems: 'flex-start' }}>
          <Icon name="warning" style={{ marginTop: 1 }} />
          <span>
            {error.message} {error.recovery && <span style={{ fontWeight: 400 }}>{error.recovery}</span>}
          </span>
        </p>
      )}
      <button className="btn btn-primary btn-lg btn-block" type="submit" disabled={busy || !email || !password} aria-busy={busy}>
        {busy && <Spinner />}
        {signup ? 'Create account' : 'Sign in'}
      </button>
      {!narrow && (
        <p className="t-caption" style={{ textAlign: 'center' }}>
          Study participants: use the email your researcher invited. You&rsquo;ll only appear in the study as a code (S01–S12).
        </p>
      )}
    </form>
  )

  if (narrow) {
    return (
      <main style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', padding: '24px 20px', gap: 24 }}>
        {brand}
        <div className="app dark" style={{ borderRadius: 16, background: 'var(--stage)', padding: 12 }}>
          <StageArt />
        </div>
        {form}
        <div style={{ flex: 1 }} />
        <p className="t-caption" style={{ textAlign: 'center' }}>
          {signup
            ? 'Next: choose what is stored. Nothing is uploaded until you say so.'
            : 'Pose estimation runs on this device. Study clips are never uploaded.'}
        </p>
      </main>
    )
  }

  return (
    <main style={{ minHeight: '100vh', display: 'flex', flexWrap: 'wrap' }}>
      <section style={{ flex: '1 1 520px', minWidth: 0, display: 'flex', flexDirection: 'column', padding: '32px 24px' }}>
        {brand}
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '48px 0' }}>{form}</div>
        <p className="t-caption">KSU CS 4850 capstone</p>
      </section>

      <aside style={{ flex: '1 1 520px', minWidth: 0, padding: 24, display: 'flex' }}>
        <div
          className="app dark"
          style={{
            flex: 1,
            borderRadius: 20,
            background: 'var(--stage)',
            padding: 40,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            gap: 32,
            minHeight: 560,
          }}
        >
          <div style={{ maxWidth: 520, width: '100%', alignSelf: 'center' }}>
            <StageArt />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 480 }}>
            <h2 className="t-h2" style={{ color: 'var(--bone)' }}>
              Your video stays with you.
            </h2>
            <ul style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {POINTS.map((p) => (
                <li key={p.icon} style={{ display: 'flex', gap: 12, color: 'var(--bone-2)' }}>
                  <Icon name={p.icon} size={18} style={{ marginTop: 2 }} />
                  {p.text}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </aside>
    </main>
  )
}
