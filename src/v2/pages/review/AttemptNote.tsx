// The dancer's own note on an attempt (FR-3.5.7), saved as they type. The note stays in
// the account (owner-only RLS); it is never sent to the practice notes or Mika.

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { updateAttemptNote } from '../../../data/repo'
import { NOTE_MAX_CHARS } from '../../../data/schema'
import { client } from '../../auth'
import { Icon } from '../../components'
import { invalidate } from '../../data'
import { createNoteAutosave, type NoteAutosave, type NoteSaveState } from './noteAutosave'

export function AttemptNote({ attemptId, note }: { attemptId: string; note: string | null }) {
  const initial = note ?? ''
  const [state, setState] = useState<NoteSaveState>({ status: 'saved', text: initial })
  const saver = useRef<NoteAutosave | null>(null)

  useEffect(() => {
    const s = createNoteAutosave({
      initial,
      save: async (text) => {
        const row = await updateAttemptNote(client(), attemptId, text)
        // The library cache keeps the note for the next visit.
        invalidate()
        return row.note ?? ''
      },
      onState: setState,
    })
    saver.current = s
    return () => {
      // Leaving the attempt saves what was typed, then stops updating this view.
      void s.flush()
      s.dispose()
    }
    // One saver per attempt; `initial` only seeds it.
  }, [attemptId])

  const length = [...state.text.trim()].length
  const tooLong = length > NOTE_MAX_CHARS
  const change = (text: string) => {
    if ([...text.trim()].length > NOTE_MAX_CHARS) {
      // Kept on screen, never cut; it is saved once it fits.
      setState({ status: 'dirty', text })
      return
    }
    saver.current?.change(text)
  }

  let status: ReactNode
  if (tooLong) {
    status = (
      <span className="err-msg">
        <Icon name="warning" />
        {length} of {NOTE_MAX_CHARS} characters. Shorten it to save.
      </span>
    )
  } else if (state.status === 'error') {
    status = (
      <span className="err-msg" style={{ flexWrap: 'wrap' }}>
        <Icon name="warning" />
        Not saved. {state.message} {state.recovery}
        <button className="btn btn-ghost btn-sm" type="button" onClick={() => void saver.current?.flush()}>
          Try again
        </button>
      </span>
    )
  } else if (state.status === 'saving') status = 'Saving…'
  else if (state.status === 'dirty') status = 'Unsaved changes…'
  else
    status = (
      <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
        <Icon name="check" size={14} />
        {state.text.trim() ? 'Saved' : 'No note yet'}
      </span>
    )

  return (
    <section className="field" aria-labelledby="rev-note-h">
      <label className="field-label" id="rev-note-h" htmlFor="rev-note">
        My note on this attempt
      </label>
      <textarea
        id="rev-note"
        className="input"
        rows={3}
        value={state.text}
        placeholder="What did you notice or try? Only you see this."
        aria-describedby="rev-note-status rev-note-hint"
        aria-invalid={tooLong || state.status === 'error' || undefined}
        onChange={(e) => change(e.target.value)}
        onBlur={() => {
          if (!tooLong) void saver.current?.flush()
        }}
        style={{ height: 'auto', minHeight: 84, padding: '10px 12px', resize: 'vertical' }}
      />
      <span className="hint" id="rev-note-status" role="status" aria-live="polite">
        {status}
      </span>
      <span className="t-caption" id="rev-note-hint">
        Saved to your account only. Not used by the practice notes or Mika.
      </span>
    </section>
  )
}
