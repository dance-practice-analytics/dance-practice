// First-run welcome for a dancer with no clips yet: three steps, Import clips, or a
// synthetic sample session to try Review and Compare without a video at hand.

import { useState } from 'react'
import { ApiError } from '../../../api/errors'
import { ErrorAlert, Icon, PrivacyPill, Spinner } from '../../components'
import { href, navigate } from '../../router'

const STEPS = [
  { title: 'Import a clip', text: 'Pick a video of one movement. The pose is found on this device; the video is never uploaded.' },
  { title: 'Review an attempt', text: 'Watch the skeleton over the clip and read what was measured in each phase.' },
  { title: 'Compare two attempts', text: 'Line up two of your own attempts and see how each measurement changed.' },
]

export function Welcome({ narrow }: { narrow: boolean }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ message: string; recovery?: string } | null>(null)

  const trySample = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      // Loaded on demand: the sample builder pulls in the synthetic generator.
      const { createSampleSession } = await import('../../sampleSave')
      const first = await createSampleSession()
      navigate({ name: 'review', attemptId: first })
    } catch (e) {
      setError(
        e instanceof ApiError
          ? { message: e.message, recovery: e.recovery ?? undefined }
          : { message: 'The sample session couldn’t be created.', recovery: 'Try again in a moment.' },
      )
      setBusy(false)
    }
  }

  const btn = narrow ? ' btn-lg btn-block' : ''
  return (
    <section
      className="card"
      aria-labelledby="welcome-h"
      style={{ padding: narrow ? 16 : 28, display: 'flex', flexDirection: 'column', gap: narrow ? 16 : 20, maxWidth: 760 }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <p className="t-label">Welcome</p>
        <h2 className={narrow ? 't-h3' : 't-h2'} id="welcome-h">
          Start with one movement
        </h2>
        <p className="t-small muted">No clips yet. Here is how it works, in three steps.</p>
      </div>

      <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {STEPS.map((s, i) => (
          <li key={s.title} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            <span
              aria-hidden="true"
              className="mono"
              style={{
                flex: '0 0 28px',
                height: 28,
                borderRadius: 999,
                display: 'grid',
                placeItems: 'center',
                background: 'var(--accent-soft)',
                color: 'var(--text)',
                border: '1px solid var(--accent-line)',
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              {i + 1}
            </span>
            <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
              <span className="t-small" style={{ fontWeight: 600, color: 'var(--text)' }}>
                <span className="v2-sr">Step {i + 1}: </span>
                {s.title}
              </span>
              <span className="t-small muted">{s.text}</span>
            </span>
          </li>
        ))}
      </ol>

      {error && <ErrorAlert error={error} onRetry={() => void trySample()} />}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', flexDirection: narrow ? 'column' : 'row' }}>
        <a className={`btn btn-primary${btn}`} href={href({ name: 'import' })}>
          <Icon name="import" />
          Import clips
        </a>
        <button className={`btn btn-secondary${btn}`} type="button" onClick={() => void trySample()} disabled={busy} aria-busy={busy}>
          {busy ? <Spinner size={12} /> : <Icon name="play" />}
          {busy ? 'Preparing the sample…' : 'Try with a sample session'}
        </button>
      </div>

      <p className="t-caption">
        No video at hand? The sample session is three relevé balance attempts made from a synthetic stick figure — no real
        dancer, no video, so Review shows the skeleton only. It is labelled “Sample session (synthetic)” and you can delete it
        from the Library at any time.
      </p>
      {!narrow && <PrivacyPill style={{ alignSelf: 'flex-start' }} />}
    </section>
  )
}
