// Screen 1 — sign in / create account.
// Design: SignIn.dc.html (wide: form + dark "Your video stays with you" panel) and
// SignInMobile.dc.html (stage on top, form below). One responsive component.
// "Forgot password?" (FR-3.1.3) switches the form to the reset request; the link in the
// email opens ResetPassword. Left out: the email sign-in link (no design need yet).

import { useState, type FormEvent } from 'react'
import { MIN_PASSWORD } from '../../api/authErrors'
import { ApiError } from '../../api/errors'
import { clearLinkError, requestPasswordReset, signIn, signUp, useAuth } from '../auth'
import { Icon, Logo, Spinner, type IconName } from '../components'
import { playEntrance } from '../Entrance'
import { useIsNarrow } from '../useIsNarrow'

type Mode = 'signin' | 'signup' | 'reset'

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
// A relevé in passé seen from the front: arms in high fifth, the working foot at the
// supporting knee, the trunk (what the app measures) in the stage lime and the
// plumb line through the supporting foot. Joints follow the MediaPipe topology.
const J = {
  head: [100, 40], neck: [100, 60],
  ls: [82, 63], rs: [118, 63], le: [65, 36], re: [135, 36], lw: [85, 11], rw: [115, 11],
  lh: [90, 128], rh: [110, 128], mh: [100, 128],
  lk: [95, 186], la: [97, 232], lt: [98, 246],
  rk: [148, 160], ra: [103, 181], rt: [96, 187],
} as const
const pts = (...keys: (keyof typeof J)[]) => keys.map((k) => J[k].join(',')).join(' ')
// Arms in high fifth are rounded: one curve from shoulder to wrist passing the elbow.
const ARM_L = 'M82,63 C58,52 60,20 85,11'
const ARM_R = 'M118,63 C142,52 140,20 115,11'
const DOTS: (keyof typeof J)[] = ['ls', 'rs', 'le', 're', 'lw', 'rw', 'lh', 'rh', 'lk', 'la', 'lt', 'rk', 'ra']

function StageArt() {
  const bone = 'var(--bone)'
  const lime = 'var(--stage-accent)'
  return (
    <div
      aria-hidden="true"
      style={{ position: 'relative', width: '100%', aspectRatio: '4 / 3', background: 'radial-gradient(120% 70% at 50% 100%, rgba(200,245,74,.10), transparent 60%), linear-gradient(var(--stage), var(--stage-2) 76%)', borderRadius: 12, overflow: 'hidden' }}
    >
      <style>{`
        @media (prefers-reduced-motion: no-preference) {
          .stage-art-figure { animation: stage-art-sway 6s ease-in-out infinite; transform-box: view-box; transform-origin: 98px 246px; }
        }
        @keyframes stage-art-sway { 0%, 100% { transform: rotate(-0.8deg); } 50% { transform: rotate(1.2deg); } }
      `}</style>
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: '24%', background: 'var(--stage-2)' }} />
      <div style={{ position: 'absolute', left: 0, right: 0, top: '76%', height: 1, background: 'var(--stage-line)' }} />
      <svg viewBox="0 0 200 300" style={{ position: 'absolute', top: '5%', height: '90%', left: '50%', transform: 'translateX(-50%)', overflow: 'visible' }}>
        <ellipse cx="98" cy="248" rx="26" ry="4" fill="rgba(200,245,74,.22)" />
        <line x1="98" y1="248" x2="98" y2="6" stroke="rgba(245,247,251,.3)" strokeWidth="1" strokeDasharray="2 4" />
        <g className="stage-art-figure" style={{ filter: 'drop-shadow(0 0 5px rgba(245,247,251,.16))' }}>
          {/* A faint body under the skeleton, so it reads as a dancer being tracked. */}
          <g fill="none" stroke={bone} strokeOpacity=".09" strokeLinecap="round" strokeLinejoin="round" strokeWidth="13">
            <path d={ARM_L} />
            <path d={ARM_R} />
            <polyline points={pts('lh', 'lk', 'la', 'lt')} />
            <polyline points={pts('rh', 'rk', 'ra', 'rt')} />
            <polygon points={pts('ls', 'rs', 'rh', 'lh')} fill={bone} fillOpacity=".09" strokeWidth="9" />
            <circle cx={J.head[0]} cy={J.head[1]} r="11" fill={bone} fillOpacity=".09" strokeWidth="4" />
          </g>
          <g fill="none" strokeLinecap="round" strokeLinejoin="round" stroke={bone} strokeWidth="2.4">
            <circle cx={J.head[0]} cy={J.head[1]} r="10.5" />
            <polyline points={pts('ls', 'rs')} />
            <path d={ARM_L} />
            <path d={ARM_R} />
            <polyline points={pts('lh', 'rh')} />
            <polyline points={pts('lh', 'lk', 'la', 'lt')} />
            <polyline points={pts('rh', 'rk', 'ra', 'rt')} />
            <polyline points={pts('mh', 'neck')} stroke={lime} strokeWidth="3.6" />
          </g>
          <g fill={bone}>
            {DOTS.map((k) => (
              <circle key={k} cx={J[k][0]} cy={J[k][1]} r="3" />
            ))}
            <circle cx={J.mh[0]} cy={J.mh[1]} r="3.4" fill={lime} />
            <circle cx={J.neck[0]} cy={J.neck[1]} r="3.4" fill={lime} />
          </g>
        </g>
      </svg>
    </div>
  )
}

export function SignIn() {
  const narrow = useIsNarrow()
  const { linkError } = useAuth()
  // A reset link that failed brings the user straight back to asking for a new one.
  const [mode, setMode] = useState<Mode>(linkError ? 'reset' : 'signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const [sentTo, setSentTo] = useState<string | null>(null)
  const signup = mode === 'signup'
  const reset = mode === 'reset'
  const tooShort = signup && password.length > 0 && password.length < MIN_PASSWORD

  const pick = (next: Mode) => {
    setMode(next)
    setError(null)
    setSentTo(null)
    if (next !== 'reset') clearLinkError()
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    if (reset) {
      setBusy(true)
      setError(null)
      setSentTo(null)
      try {
        await requestPasswordReset(email)
        clearLinkError()
        setSentTo(email.trim())
      } catch (err) {
        setError(err as ApiError)
      } finally {
        setBusy(false)
      }
      return
    }
    if (signup && password.length < MIN_PASSWORD) {
      setError(new ApiError(422, 'weak_password', 'That password is too short.', `Use at least ${MIN_PASSWORD} characters.`))
      return
    }
    setBusy(true)
    setError(null)
    try {
      await (signup ? signUp(email, password) : signIn(email, password))
      // The auth store now shows the consent screen or the app; the dancer turns over it.
      playEntrance()
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
        <h1 className="t-h1">{reset ? 'Reset your password' : signup ? 'Create your account' : 'Welcome back'}</h1>
        {reset ? (
          <p className="muted">We’ll email you a link to set a new password. Open it in this browser.</p>
        ) : (
          !narrow && <p className="muted">Review your practice clips, one movement at a time.</p>
        )}
      </div>
      {reset && linkError && !sentTo && (
        <p className="err-msg" role="alert" style={{ alignItems: 'flex-start' }}>
          <Icon name="warning" style={{ marginTop: 1 }} />
          <span>
            {linkError.message} {linkError.recovery && <span style={{ fontWeight: 400 }}>{linkError.recovery}</span>}
          </span>
        </p>
      )}
      {!reset && (
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
      )}
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
      {!reset && (
        <div className={tooShort ? 'field has-error' : 'field'}>
          <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
            <label className="field-label" htmlFor="si-pw">
              Password
            </label>
            {!signup && (
              <button type="button" className="btn btn-ghost btn-sm" style={{ height: 'auto', padding: 0 }} onClick={() => pick('reset')}>
                Forgot password?
              </button>
            )}
          </span>
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
      )}
      {sentTo && (
        <p className="t-small" role="status" style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          <Icon name="mail" style={{ marginTop: 2 }} />
          <span>
            If there is an account for <strong>{sentTo}</strong>, a reset link is on its way. It can take a few minutes; check
            spam too. The link works once.
          </span>
        </p>
      )}
      {error && (
        <p className="err-msg" role="alert" style={{ alignItems: 'flex-start' }}>
          <Icon name="warning" style={{ marginTop: 1 }} />
          <span>
            {error.message} {error.recovery && <span style={{ fontWeight: 400 }}>{error.recovery}</span>}
          </span>
        </p>
      )}
      <button
        className="btn btn-primary btn-lg btn-block"
        type="submit"
        disabled={busy || !email || (!reset && !password)}
        aria-busy={busy}
      >
        {busy && <Spinner />}
        {reset ? (sentTo ? 'Send again' : 'Send reset link') : signup ? 'Create account' : 'Sign in'}
      </button>
      {reset && (
        <button className="btn btn-ghost btn-block" type="button" onClick={() => pick('signin')} disabled={busy}>
          <Icon name="chevron-left" />
          Back to sign in
        </button>
      )}
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
          <div style={{ maxWidth: 560, width: '100%', alignSelf: 'center' }}>
            <StageArt />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 480 }}>
            <h2 className="t-h2" style={{ color: 'var(--bone)' }}>
              Your video <span style={{ color: 'var(--lime)' }}>stays with you.</span>
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
