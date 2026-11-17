// Under the Review stage:
// - Correcting the camera position set at import (opened from "Correct" in the camera
//   switch, CameraSwitch.tsx): sessions.camera_view, the whole session, owner RLS.
//   Compare, Progress, Mika and the take links (takes.ts) group by it.
// - Why only the skeleton shows: the video stays on this device and is never stored, so
//   after a reload the same file has to be added again (matched by its content).

import { useState } from 'react'
import type { ApiError } from '../../../api/errors'
import { CAMERA_VIEWS, type CameraView } from '../../../data/schema'
import { dataError, updateSession } from '../../../data/repo'
import { client } from '../../auth'
import { Icon, Spinner } from '../../components'
import { invalidate } from '../../data'

export const CAMERA_WORDS: Record<CameraView, string> = { front: 'Front', side: 'Side', diagonal: 'Diagonal' }

/** Stage pill text: where the camera stood, not a view to switch to. */
export function filmedFromLabel(view: CameraView | null, narrow: boolean): string | undefined {
  if (!view) return undefined
  return narrow ? `Filmed: ${CAMERA_WORDS[view]}` : `Filmed from: ${CAMERA_WORDS[view]}`
}

export interface StageInfoProps {
  sessionId: string
  view: CameraView | null
  /** Attempts in the session (a correction applies to all of them). */
  attemptCount: number
  /** The video isn't on this device (and this isn't the synthetic sample). */
  videoMissing: boolean
  /** The correction row is open (toggled by the camera switch). */
  editing: boolean
  onEditingChange(open: boolean): void
}

export function StageInfo({ sessionId, view, attemptCount, videoMissing, editing, onEditingChange: setEditing }: StageInfoProps) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)

  const save = async (next: CameraView) => {
    if (next === view) {
      setEditing(false)
      return
    }
    setBusy(true)
    setError(null)
    try {
      await updateSession(client(), sessionId, { camera_view: next })
      invalidate()
      setEditing(false)
    } catch (e) {
      setError(dataError(e))
    } finally {
      setBusy(false)
    }
  }

  if (!editing && !error && !videoMissing) return null
  return (
    <div className="v2-rev-stageinfo">
      {editing && (
        <div className="v2-rev-stageinfo-edit" role="group" aria-label="Correct where the camera stood">
          <span className="t-small" style={{ fontWeight: 500 }}>Camera position:</span>
          <div className="seg">
            {CAMERA_VIEWS.map((v) => (
              <button key={v} type="button" className={v === view ? 'on' : undefined} aria-pressed={v === view} disabled={busy} onClick={() => void save(v)}>
                {CAMERA_WORDS[v]}
              </button>
            ))}
          </div>
          <button type="button" className="btn btn-ghost v2-rev-stageinfo-btn" disabled={busy} onClick={() => setEditing(false)}>
            Cancel
          </button>
          {busy && <Spinner size={14} />}
          <p className="t-caption" style={{ flexBasis: '100%', margin: 0 }}>
            Where the camera stood for this clip, set at import. Applies to {attemptCount === 1 ? 'this session’s attempt' : `all ${attemptCount} attempts of this session`}. The measurements stay the same; Compare and
            Progress line up attempts filmed from the same position.
          </p>
        </div>
      )}
      {error && (
        <p role="alert" className="t-caption" style={{ margin: 0 }}>
          {error.message} {error.recovery}
        </p>
      )}
      {videoMissing && (
        <p className="v2-rev-stageinfo-line">
          <Icon name="device" size={16} />
          <span className="muted">Video stays on your device and isn’t stored. Add the same file again to see it under the skeleton.</span>
        </p>
      )}
    </div>
  )
}
