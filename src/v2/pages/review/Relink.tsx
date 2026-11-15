// "Choose the file again": study clips are never uploaded, so after a reload the video
// is gone while the keypoints remain. The dancer re-picks the file; it is matched to an
// attempt by its SHA-256 on this device (clips.ts › relink) and never leaves it.

import { useRef, useState } from 'react'
import { relink } from '../../clips'
import { Icon, Spinner } from '../../components'
import type { AttemptView } from '../../data'

export interface RelinkNoteProps {
  /** The attempts whose video is missing here, with the words that name them ('this attempt', 'A'). */
  missing: { attempt: AttemptView; name: string }[]
  /** Every attempt a picked file may belong to. */
  attempts: readonly AttemptView[]
  /** How to name another attempt a file turned out to belong to. */
  describe(attempt: AttemptView): string
}

export function RelinkNote({ missing, attempts, describe }: RelinkNoteProps) {
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  if (missing.length === 0) return null
  const many = missing.length > 1
  const names = missing.map((m) => m.name).join(' and ')
  const clipNames = missing.map((m) => m.attempt.clip_name).filter(Boolean)

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
    setMessage(notes.join(' ') || null)
    setBusy(false)
    if (input.current) input.current.value = ''
  }

  return (
    <div className="note-box" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
      <Icon name="device" />
      <p style={{ flex: '1 1 260px', minWidth: 0 }}>
        <strong style={{ color: 'var(--text)' }}>
          The video of {names} isn’t on this device right now.
        </strong>{' '}
        The skeleton is drawn from the saved keypoints. Study clips are never uploaded — choose the {many ? 'files' : 'file'} again to see the
        video under the skeleton
        {clipNames.length > 0 && (
          <>
            {' '}
            (<span className="mono" style={{ fontSize: 12 }}>{clipNames.join(', ')}</span>)
          </>
        )}
        .
        {message && (
          <span role="status" style={{ display: 'block', marginTop: 4, color: 'var(--text)' }}>
            {message}
          </span>
        )}
      </p>
      <button className="btn btn-secondary btn-sm" type="button" disabled={busy} aria-busy={busy} onClick={() => input.current?.click()}>
        {busy ? <Spinner size={12} /> : <Icon name="upload" />}
        Choose the {many ? 'files' : 'file'} again
      </button>
      <input
        ref={input}
        type="file"
        accept="video/*"
        multiple={many}
        hidden
        data-testid="relink-input"
        onChange={(e) => void pick(e.target.files)}
      />
    </div>
  )
}
