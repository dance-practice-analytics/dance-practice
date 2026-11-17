// "Front · Diagonal · Side" over the Review and Compare stages: the same take filmed from
// another camera, at the same moment (see takes.ts). A camera that didn't film this take
// stays in the row, unavailable, with the reason as its tooltip and description.
// Keyboard: Tab into the row, ←/→ move between cameras, Enter / Space switch.

import { useId, useRef, type KeyboardEvent } from 'react'
import type { CameraView } from '../../../data/schema'
import { Icon } from '../../components'

/** The order the cameras are offered in. */
export const SWITCH_ORDER: readonly CameraView[] = ['front', 'diagonal', 'side']
export const CAMERA_NAMES: Record<CameraView, string> = { front: 'Front', side: 'Side', diagonal: 'Diagonal' }
export const NOT_FILMED = 'Not filmed from this camera'
export const DIAGONAL_HINT = 'Diagonal gives the steadiest values.'

export interface CameraSwitchProps {
  /** Camera of what is on the stage; null when it wasn't set at import (or A and B differ). */
  current: CameraView | null
  /** Why a camera can't be picked; absent = available. */
  unavailable: Partial<Record<CameraView, string>>
  onPick(view: CameraView): void
  /** Secondary: correct the camera position stored for the session. */
  onCorrect?: () => void
  correctLabel?: string
  /** The line under the row. */
  hint?: string
  narrow?: boolean
}

export function CameraSwitch({ current, unavailable, onPick, onCorrect, correctLabel = 'Correct', hint, narrow }: CameraSwitchProps) {
  const id = useId()
  const group = useRef<HTMLDivElement>(null)

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft' && e.key !== 'Home' && e.key !== 'End') return
    const buttons = [...(group.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement)
    const n = buttons.length
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : (at + (e.key === 'ArrowRight' ? 1 : -1) + n) % n
    buttons[next]?.focus()
    e.preventDefault()
  }

  return (
    <div className={narrow ? 'v2-cam is-narrow' : 'v2-cam'}>
      <div className="v2-cam-row">
        <span className="v2-cam-label" id={`${id}-l`}>
          <Icon name="camera" size={16} />
          Camera
        </span>
        <div className="seg v2-cam-seg" role="group" aria-labelledby={`${id}-l`} ref={group} onKeyDown={onKeyDown}>
          {SWITCH_ORDER.map((v) => {
            const on = v === current
            const why = unavailable[v]
            const off = !on && why !== undefined
            return (
              <button
                key={v}
                type="button"
                className={on ? 'on' : off ? 'is-off' : undefined}
                aria-pressed={on}
                aria-disabled={off || undefined}
                aria-describedby={off ? `${id}-${v}` : undefined}
                title={off ? why : v === 'diagonal' && !on ? DIAGONAL_HINT : undefined}
                onClick={() => {
                  if (!on && !off) onPick(v)
                }}
              >
                {CAMERA_NAMES[v]}
                {off && (
                  <span id={`${id}-${v}`} className="v2-cam-sr">
                    {`: ${why}`}
                  </span>
                )}
              </button>
            )
          })}
        </div>
        {onCorrect && (
          <button type="button" className="btn btn-ghost v2-cam-correct" aria-label={`${correctLabel}: where the camera stood for this session`} onClick={onCorrect}>
            {correctLabel}
          </button>
        )}
      </div>
      {hint && <p className="v2-cam-hint">{hint}</p>}
    </div>
  )
}
