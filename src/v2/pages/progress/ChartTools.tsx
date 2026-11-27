// Progress chart tools (mentor review, change 5): the axis options shared by every chart on
// the page, and the Expand dialog that shows one chart large, with a range of sessions to
// zoom into. Display only: the values, medians and change text don't depend on them.

import { useState, type ReactNode } from 'react'
import { Icon } from '../../components'
import { Modal } from '../settings/Modal'
import '../settings/settings.css'
import type { ProgressSession } from '../../../insights'
import { ProgressChart } from './ProgressChart'
import type { ChartAxis, ChartGeometry, ChartOptions, SessionColumn } from './model'

export function ChartOptionsControl({ value, onChange }: { value: ChartOptions; onChange(next: ChartOptions): void }) {
  const y = value.y ?? 'zero'
  const x = value.x ?? 'sessions'
  const seg = <T extends string>(id: string, label: string, current: T, items: [T, string][], set: (v: T) => void) => (
    <div className="field" style={{ flex: '0 1 auto' }}>
      <span className="field-label" id={id}>
        {label}
      </span>
      <div className="seg" role="radiogroup" aria-labelledby={id}>
        {items.map(([k, text]) => (
          <button key={k} type="button" role="radio" aria-checked={k === current} className={k === current ? 'on' : undefined} onClick={() => set(k)}>
            {text}
          </button>
        ))}
      </div>
    </div>
  )
  return (
    <>
      {seg('prog-y', 'Y axis', y, [['zero', 'From 0'], ['fit', 'Fit to values']], (v) => onChange({ ...value, y: v }))}
      {seg('prog-x', 'X axis', x, [['sessions', 'Sessions'], ['attempts', 'Attempts']], (v) => onChange({ ...value, x: v }))}
    </>
  )
}

export interface ExpandablePanel {
  key: string
  title: string
  geometry: ChartGeometry
  aria: string
  data: readonly ProgressSession[]
  axis: ChartAxis
  summary: string
}

/** The Expand button of a chart card and its dialog. */
export function ExpandChart({ panel, sessions, options, onOptions, narrow }: { panel: ExpandablePanel; sessions: readonly SessionColumn[]; options: ChartOptions; onOptions(o: ChartOptions): void; narrow: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(true)} aria-label={`Expand ${panel.title}`} title="Expand this chart">
        <Icon name="search" size={16} />
        {!narrow && 'Expand'}
      </button>
      {open && <Expanded panel={panel} sessions={sessions} options={options} onOptions={onOptions} narrow={narrow} onClose={() => setOpen(false)} />}
    </>
  )
}

function Expanded({ panel, sessions, options, onOptions, narrow, onClose }: { panel: ExpandablePanel; sessions: readonly SessionColumn[]; options: ChartOptions; onOptions(o: ChartOptions): void; narrow: boolean; onClose(): void }) {
  // Zoom on x: a range of sessions (all by default).
  const [from, setFrom] = useState(0)
  const [to, setTo] = useState(sessions.length - 1)
  const lo = Math.min(from, to)
  const hi = Math.max(from, to)
  const shown = sessions.slice(lo, hi + 1)
  const ids = new Set(shown.map((s) => s.sessionId))
  const data = panel.data.filter((s) => ids.has(s.sessionId))
  const headingId = `prog-exp-${panel.key}`
  const pick = (label: string, value: number, set: (v: number) => void): ReactNode => (
    <label className="field" style={{ flex: '0 1 auto' }}>
      <span className="field-label">{label}</span>
      <select className="input input-sm" value={value} onChange={(e) => set(Number(e.target.value))}>
        {sessions.map((s, i) => (
          <option key={s.sessionId} value={i}>
            {s.name} · {s.dateLabel}
          </option>
        ))}
      </select>
    </label>
  )
  return (
    <Modal labelledBy={headingId} onClose={onClose} wide={760} sheet={narrow}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
        <h2 className="t-h3" id={headingId}>
          {panel.title}
        </h2>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} data-autofocus>
          Close
        </button>
      </div>
      <div className="v2-prog-filters">
        <ChartOptionsControl value={options} onChange={onOptions} />
        {sessions.length > 2 && (
          <>
            {pick('From', from, setFrom)}
            {pick('To', to, setTo)}
          </>
        )}
      </div>
      <ProgressChart panel={{ ...panel, data }} sessions={shown} options={options} large />
      <p className="t-small muted">{panel.summary}</p>
      <p className="t-caption">Point at a dot to see its value. The axis options and the range only change the drawing, not the values or medians.</p>
    </Modal>
  )
}
