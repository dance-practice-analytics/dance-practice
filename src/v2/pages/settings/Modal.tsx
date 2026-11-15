// The confirmation dialog of Settings.dc.html (centred) and the bottom sheet of
// SettingsMobile.dc.html, as one modal: focus moves in, Tab stays inside, Escape and
// the scrim cancel, focus returns to the control that opened it.

import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react'

export interface ModalProps {
  /** id of the heading inside. */
  labelledBy: string
  describedBy?: string
  /** Bottom sheet (phones). */
  sheet?: boolean
  /** While true, Escape and the scrim don't close it. */
  busy?: boolean
  onClose(): void
  children: ReactNode
}

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled])'

export function Modal({ labelledBy, describedBy, sheet, busy, onClose, children }: ModalProps) {
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    const first = box.current?.querySelector<HTMLElement>('[data-autofocus]') ?? box.current?.querySelector<HTMLElement>(FOCUSABLE)
    ;(first ?? box.current)?.focus()
    return () => opener?.focus?.()
  }, [])

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && !busy) {
      e.stopPropagation()
      onClose()
      return
    }
    if (e.key !== 'Tab' || !box.current) return
    const items = [...box.current.querySelectorAll<HTMLElement>(FOCUSABLE)]
    if (items.length === 0) return e.preventDefault()
    const first = items[0]
    const last = items[items.length - 1]
    if (e.shiftKey && (document.activeElement === first || document.activeElement === box.current)) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first.focus()
    }
  }

  return (
    <div
      className={sheet ? 'v2-set-scrim is-sheet' : 'v2-set-scrim'}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose()
      }}
      onKeyDown={onKeyDown}
    >
      <div
        ref={box}
        className="dialog v2-set-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        tabIndex={-1}
      >
        {sheet && (
          <span aria-hidden="true" style={{ alignSelf: 'center', width: 40, height: 4, borderRadius: 2, background: 'var(--line-strong)' }} />
        )}
        {children}
      </div>
    </div>
  )
}
