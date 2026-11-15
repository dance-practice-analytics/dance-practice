// Screen 2 — consent, shown after sign-in until both required scopes are accepted
// (FR-3.1.6). Design: Consent.dc.html and ConsentMobile.dc.html.
// Writes one `consents` row per accepted scope (required and optional) with the
// consent text version; optional choices can be changed later in Settings through
// `setConsent()` in ../consents.
// Left out: the "Full privacy notice" link — there is no such page yet.

import { useState } from 'react'
import type { ApiError } from '../../api/errors'
import { dataError } from '../../data/repo'
import { signOut, useAuth } from '../auth'
import { ErrorAlert, Icon, Logo, Spinner, type IconName } from '../components'
import { acceptConsents, type ConsentScope } from '../consents'
import { useIsNarrow } from '../useIsNarrow'

interface Choice {
  scope: ConsentScope
  required: boolean
  title: string
  detail: string
  /** Phone wording (ConsentMobile.dc.html). */
  short: [strong: string, rest: string]
}

const CHOICES: Choice[] = [
  {
    scope: 'on_device_processing',
    required: true,
    title: 'I understand study clips are processed on this device and never uploaded.',
    detail: 'Processing needs this browser tab open. It works offline.',
    short: ['Study clips are processed on this device and never uploaded.', ''],
  },
  {
    scope: 'keypoints_and_metrics_storage',
    required: true,
    title: 'Save keypoints and metrics to my account.',
    detail: 'Needed to show change between attempts and sessions.',
    short: ['Save keypoints and metrics to my account.', ''],
  },
  {
    scope: 'ai_metrics_only',
    required: false,
    title: 'Allow AI practice notes.',
    detail: 'Sends one attempt’s metrics when you press Generate. Not medical advice.',
    short: ['Allow AI practice notes', ' (metrics only).'],
  },
  {
    scope: 'own_video_upload',
    required: false,
    title: 'Allow uploading my own videos for backup.',
    detail: 'Applies to your personal videos only. Study clips can never be uploaded.',
    short: ['Allow uploading my own videos', ' for backup.'],
  },
]

interface Info {
  icon: IconName
  title: string
  items: string[]
  /** Phone: one paragraph instead of the list. */
  summary: string
}

const INFO: Info[] = [
  {
    icon: 'device',
    title: 'Never leaves this device',
    items: ['Study video clips', 'Video frames used for pose estimation', 'Your own videos, unless you turn on upload'],
    summary: 'Study clips and the video frames used for pose estimation. Your own videos too, unless you turn on upload.',
  },
  {
    icon: 'lock',
    title: 'Saved to your account',
    items: [
      'Keypoints — body-point coordinates per frame, no images',
      'Metrics for each attempt, with confidence',
      'Practice notes you choose to generate',
      'In study data you appear only as a code (S01–S12)',
    ],
    summary: 'Keypoints (no images), metrics with confidence, and notes you generate. Study data uses a code, never a name.',
  },
  {
    icon: 'notes',
    title: 'Sent to the AI, if you allow',
    items: ['One attempt’s metrics: name, value, unit, phase, confidence'],
    summary: 'One attempt’s metric values only. Never video, images, keypoints, name or email.',
  },
]

// Labelled as an example on the screen; these are illustrative values, not measurements.
const PAYLOAD_EXAMPLE = ['trunk_inclination: 4.2° · hold · high', 'balance_duration: 3.4 s · hold · high', 'knee_tracking: 8.7° · hold · low']

export function Consent() {
  const narrow = useIsNarrow()
  const { user } = useAuth()
  // Nothing is pre-ticked: consent is something the person does.
  const [picked, setPicked] = useState<ReadonlySet<ConsentScope>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const ready = CHOICES.every((c) => !c.required || picked.has(c.scope))

  const flip = (scope: ConsentScope) =>
    setPicked((prev) => {
      const next = new Set(prev)
      if (!next.delete(scope)) next.add(scope)
      return next
    })

  const agree = async () => {
    if (!ready || busy) return
    setBusy(true)
    setError(null)
    try {
      await acceptConsents(CHOICES.filter((c) => picked.has(c.scope)).map((c) => c.scope))
      // The gate in App.tsx now opens the app.
    } catch (e) {
      setError(dataError(e))
      setBusy(false)
    }
  }

  const footnote = ready
    ? narrow
      ? 'Optional choices can be changed in Settings.'
      : 'You can export or delete all saved data from Settings › Data at any time.'
    : 'Tick both required boxes to continue.'

  const agreeButton = (
    <button
      className={narrow ? 'btn btn-primary btn-lg btn-block' : 'btn btn-primary btn-lg'}
      type="button"
      disabled={!ready || busy}
      aria-busy={busy}
      aria-describedby="consent-note"
      onClick={agree}
    >
      {busy && <Spinner />}
      Agree and continue
    </button>
  )

  const example = (
    <div className="well mono" style={{ padding: '10px 12px', fontSize: 11, lineHeight: '17px', color: 'var(--text-2)' }}>
      {(narrow ? [PAYLOAD_EXAMPLE[0], PAYLOAD_EXAMPLE[2]] : PAYLOAD_EXAMPLE).map((line) => (
        <div key={line}>{line}</div>
      ))}
    </div>
  )

  if (narrow) {
    return (
      <main style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column' }}>
        <div className="mhead" style={{ position: 'sticky', top: 0, zIndex: 20 }}>
          <span className="t-h3" style={{ flex: 1 }}>
            Before you start
          </span>
          <button className="btn btn-ghost btn-sm" type="button" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
        <div style={{ flex: 1, padding: '20px 16px', display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <h1 className="t-h1">What happens to your data</h1>
            <p className="t-small muted">You can export or delete everything later in Settings.</p>
          </div>
          <div className="card" style={{ display: 'flex', flexDirection: 'column' }}>
            {INFO.map((info, i) => (
              <div key={info.title}>
                {i > 0 && <div className="hr" />}
                <section style={{ padding: 16, display: 'flex', gap: 12 }}>
                  <Icon name={info.icon} size={20} style={{ marginTop: 2 }} />
                  <div style={{ display: 'flex', flexDirection: 'column', gap: i === 2 ? 8 : 4, minWidth: 0 }}>
                    <h2 className="t-h3">{info.title}</h2>
                    <p className="t-small muted">{info.summary}</p>
                    {i === 2 && example}
                  </div>
                </section>
              </div>
            ))}
          </div>

          <section style={{ display: 'flex', flexDirection: 'column', gap: 16 }} aria-labelledby="consent-h">
            <h2 className="t-h3" id="consent-h">
              Your choices
            </h2>
            {CHOICES.map((c) => (
              <label className="check" key={c.scope}>
                <input type="checkbox" checked={picked.has(c.scope)} onChange={() => flip(c.scope)} />
                <span className="t-small">
                  <span style={{ fontWeight: 500 }}>{c.short[0]}</span>
                  {c.short[1]} <span className="subtle">{c.required ? 'Required' : 'Optional'}</span>
                </span>
              </label>
            ))}
          </section>
          {error && <ErrorAlert error={error} />}
        </div>
        <div
          style={{
            position: 'sticky',
            bottom: 0,
            padding: 16,
            borderTop: '1px solid var(--line)',
            background: 'var(--surface)',
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
          <p className="t-caption" id="consent-note" style={{ textAlign: 'center' }}>
            {footnote}
          </p>
          {agreeButton}
        </div>
      </main>
    )
  }

  return (
    <main style={{ minHeight: '100vh', padding: '32px 24px 64px' }}>
      <div style={{ maxWidth: 1080, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 32 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Logo />
          <span className="t-h3">Dance Practice Analytics</span>
          <span style={{ flex: 1 }} />
          <span className="t-caption">Before you start{user?.email ? ` · ${user.email}` : ''}</span>
          <button className="btn btn-ghost btn-sm" type="button" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>

        <header style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 680 }}>
          <h1 className="t-h1">What happens to your data</h1>
          <p className="muted">Read this once. You can change optional choices, export, or delete everything later in Settings.</p>
        </header>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(300px, 100%), 1fr))', gap: 16 }}>
          {INFO.map((info, i) => (
            <section className="card" key={info.title} style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <span className="well" style={{ width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 10 }}>
                  <Icon name={info.icon} size={18} />
                </span>
                <h2 className="t-h3">{info.title}</h2>
              </div>
              <ul className="t-small muted" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {info.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
                {i === 2 && <li style={{ color: 'var(--text)' }}>Never video, images, keypoints, your name or email</li>}
              </ul>
              {i === 2 && (
                <>
                  {example}
                  <p className="t-caption">Example of exactly what is sent.</p>
                </>
              )}
            </section>
          ))}
        </div>

        <section className="card" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 18 }} aria-labelledby="consent-h">
          <h2 className="t-h3" id="consent-h">
            Your choices
          </h2>
          {CHOICES.map((c, i) => (
            <div key={c.scope} style={{ display: 'contents' }}>
              {i === 2 && <div className="hr" />}
              <label className="check">
                <input type="checkbox" checked={picked.has(c.scope)} onChange={() => flip(c.scope)} />
                <span style={{ display: 'flex', flexDirection: 'column' }}>
                  <span style={{ fontWeight: 500 }}>
                    {c.title}{' '}
                    <span className="subtle" style={{ fontWeight: 400 }}>
                      {c.required ? 'Required' : 'Optional'}
                    </span>
                  </span>
                  <span className="t-small muted">{c.detail}</span>
                </span>
              </label>
            </div>
          ))}
        </section>

        {error && <ErrorAlert error={error} />}

        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <p className="t-small subtle" id="consent-note" style={{ flex: '1 1 320px' }}>
            {footnote}
          </p>
          {agreeButton}
        </div>
      </div>
    </main>
  )
}
