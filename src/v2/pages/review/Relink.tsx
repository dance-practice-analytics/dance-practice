// "Choose the file again": study clips are never uploaded, so after a reload the video
// is gone while the keypoints remain. The dancer re-picks the file; it is matched to an
// attempt by its SHA-256 on this device (clips.ts › relink) and never leaves it.
//
// Shown as a card ON the stage (children of SyncedStage), over its lower part and
// between the pill rows. The dancer may close it for this browser session so the
// skeleton is fully visible; a small "Add video" chip then stays on the stage. On a
// phone it is a slim bar docked at the bottom of the stage (review.css).

import { useRef, useState } from 'react'
import { relink } from '../../clips'
import { Icon, Spinner } from '../../components'
import type { AttemptView } from '../../data'
import { isSampleAttempt } from '../../sampleMarkers'

const DISMISSED_KEY = 'dpa-relink-dismissed'

function loadDismissed(): Set<string> {
  try {
    return new Set(JSON.parse(sessionStorage.getItem(DISMISSED_KEY) ?? '[]') as string[])
  } catch {
    return new Set()
  }
}

function saveDismissed(ids: Set<string>): void {
  try {
    sessionStorage.setItem(DISMISSED_KEY, JSON.stringify([...ids]))
  } catch {
    // Storage blocked: the card stays closed until this page is left.
  }
}

export interface RelinkNoteProps {
  /** The attempts whose video is missing here, with the words that name them ('this attempt', 'A'). */
  missing: { attempt: AttemptView; name: string }[]
  /** Every attempt a picked file may belong to. */
  attempts: readonly AttemptView[]
  /** How to name another attempt a file turned out to belong to. */
  describe(attempt: AttemptView): string
}

/** The "Choose the file again" card (or, once closed, the "Add video" chip) on a stage. */
export function RelinkOverlay({ missing, attempts, describe }: RelinkNoteProps) {
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [dismissed, setDismissed] = useState(loadDismissed)
  if (missing.length === 0) return null
  // The synthetic sample has no video anywhere, so there is nothing to choose again.
  if (missing.every((m) => isSampleAttempt(m.attempt))) {
    return (
      <div className="v2-relink-wrap">
        <div className="v2-relink-card v2-relink-sample" role="note" aria-label="Sample session">
          <p className="v2-relink-title" style={{ paddingRight: 0 }}>
            <Icon name="info" />
            <span>
              <strong>Sample session (synthetic).</strong>{' '}
              <span className="muted">No video: a made-up stick figure, measured like a real clip.</span>
            </span>
          </p>
        </div>
      </div>
    )
  }
  const many = missing.length > 1
  const names = missing.map((m) => m.name).join(' and ')
  const clipNames = missing.map((m) => m.attempt.clip_name).filter(Boolean)
  const closed = missing.every((m) => dismissed.has(m.attempt.id))
  const setClosed = (next: boolean) => {
    const ids = new Set(dismissed)
    missing.forEach((m) => (next ? ids.add(m.attempt.id) : ids.delete(m.attempt.id)))
    saveDismissed(ids)
    setDismissed(ids)
  }
  const choose = () => input.current?.click()
  const filesWord = many ? 'files' : 'file'

  const pick = async (files: FileList | null) => {
    if (!files?.length || busy) return
    setBusy(true)
    setMessage(null)
    const notes: string[] = []
    try {
      for (const file of Array.from(files)) {
        const id = await relink(file, attempts)
        if (id === null) notes.push(`${file.name} doesn’t match any of your attempts (its content is different), so nothing was changed.`)
        else if (!missing.some((m) => m.attempt.id === id)) {
          const other = attempts.find((a) => a.id === id)
          notes.push(`${file.name} is the clip of ${other ? describe(other) : 'another attempt'}; it is linked there now.`)
        }
      }
    } catch {
      notes.push('That file couldn’t be read. Nothing was changed.')
    }
    const text = notes.join(' ') || null
    setMessage(text)
    // A file that didn't fit is explained on the card, even if it was closed.
    if (text) setClosed(false)
    setBusy(false)
    if (input.current) input.current.value = ''
  }

  // Review names its one attempt 'this attempt'; Compare says which of A and B.
  const subject = !many && missing[0].name === 'this attempt' ? 'Video' : `Video of ${names}`

  return (
    <>
      {closed ? (
        <button className="btn btn-secondary v2-relink-chip" type="button" disabled={busy} aria-busy={busy} onClick={choose}>
          {busy ? <Spinner size={14} /> : <Icon name="upload" />}
          Add video
        </button>
      ) : (
        <div className="v2-relink-wrap">
          <div className="v2-relink-card" role="region" aria-label={`${subject} not on this device`}>
            <button className="btn btn-ghost btn-icon v2-relink-close" type="button" aria-label="Hide this message" onClick={() => setClosed(true)}>
              <Icon name="close" />
            </button>
            <p className="v2-relink-title">
              <Icon name="device" />
              {/* Phone: the card is a one-line bar docked at the bottom of the stage, with shorter words. */}
              <span className="v2-relink-long">{subject} not on this device — showing the skeleton only.</span>
              <span className="v2-relink-short">{subject} not on this device</span>
            </p>
            <button className="btn btn-primary" type="button" disabled={busy} aria-busy={busy} onClick={choose}>
              {busy ? <Spinner size={14} /> : <Icon name="upload" />}
              <span className="v2-relink-long">Choose the {filesWord} again</span>
              <span className="v2-relink-short">Choose {filesWord}</span>
            </button>
            {clipNames.length > 0 && (
              <p className="v2-relink-file">
                {/* Stored names are de-identified (FR-3.2.5), so this is the clip, not the file's own name. */}
                Clip: <span className="mono">{clipNames.join(', ')}</span> · matched by its content, whatever the file is called
              </p>
            )}
            {message && (
              <p role="status" className="v2-relink-msg">
                {message}
              </p>
            )}
          </div>
        </div>
      )}
      <input
        ref={input}
        type="file"
        accept="video/*"
        multiple={many}
        hidden
        data-testid="relink-input"
        onChange={(e) => void pick(e.target.files)}
      />
    </>
  )
}
