import { useEffect, useRef, type ReactNode } from 'react'
import { saveStatus, toasts } from '../state/app'
import { useStore } from '../state/store'

/** Modal dialog on the native <dialog> element: focus trap, Esc to close, no browser alerts. */
export function Dialog({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const d = ref.current!
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])
  return (
    <dialog
      ref={ref}
      className={`dialog ${wide ? 'dialog-wide' : ''}`}
      aria-label={title}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
    >
      {open && (
        <div className="dialog-body">
          <div className="dialog-head">
            <h2>{title}</h2>
            <button className="icon-btn small" onClick={onClose} aria-label="Close">×</button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  )
}

export function Toasts() {
  const list = useStore(toasts)
  return (
    <div className="toasts" role="status" aria-live="polite">
      {list.map((t) => (
        <div key={t.id} className="toast">{t.text}</div>
      ))}
    </div>
  )
}

export function SaveIndicator() {
  const s = useStore(saveStatus)
  if (s.state === 'idle') return null
  return (
    <span className={`save save-${s.state}`} role="status" title={s.state === 'error' ? s.message : undefined}>
      {s.state === 'saving' && 'Saving…'}
      {s.state === 'saved' && '✓ Saved'}
      {s.state === 'error' && '⚠ Not saved'}
    </span>
  )
}

export function Spinner({ label }: { label: string }) {
  return (
    <div className="center-msg" role="status">
      <span className="spinner" aria-hidden="true" />
      {label}
    </div>
  )
}

export function ErrorState({ title, message, action }: { title: string; message: string; action?: ReactNode }) {
  return (
    <div className="error-state" role="alert">
      <h2>{title}</h2>
      <p>{message}</p>
      {action}
    </div>
  )
}
