// FR-3.6.6: the dancer's reference attempt — the one they compare others with. It is a
// point of comparison they choose, never a grade, so the copy never says "best".
// One per movement and subject: marking another replaces it (trigger in the database).

import { useState } from 'react'
import type { ApiError } from '../../../api/errors'
import { dataError, setReferenceAttempt } from '../../../data/repo'
import { client } from '../../auth'
import { Icon } from '../../components'
import { invalidate } from '../../data'

export const REFERENCE_LABEL = 'Reference'
export const REFERENCE_HINT = 'Reference attempt — the one you compare others with.'

/** The small neutral tag shown on Review, Library and Compare. */
export function ReferenceTag({ compact }: { compact?: boolean }) {
  return (
    <span className="tag" title={REFERENCE_HINT}>
      <Icon name="check" />
      {REFERENCE_LABEL}
      {compact ? null : <span className="v2-sr">: the attempt you compare others with</span>}
    </span>
  )
}

export function ReferenceToggle({ attemptId, on, movementLabel }: { attemptId: string; on: boolean; movementLabel: string }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)

  const toggle = async () => {
    setBusy(true)
    setError(null)
    try {
      await setReferenceAttempt(client(), attemptId, !on)
      invalidate()
    } catch (e) {
      setError(dataError(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-label="Reference attempt" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        {on && <ReferenceTag compact />}
        <button className="btn btn-ghost btn-sm" type="button" aria-pressed={on} disabled={busy} onClick={() => void toggle()}>
          {on ? 'Stop using as reference' : 'Use as reference'}
        </button>
      </div>
      <p className="t-caption">
        {on
          ? `Compare opens with this attempt as A for ${movementLabel}.`
          : `A reference is the attempt you compare others with. Compare opens with it as A. One per movement; choosing this one replaces the current one.`}
      </p>
      {error && (
        <p className="err-msg" role="alert">
          {error.message} {error.recovery}
        </p>
      )}
    </section>
  )
}
