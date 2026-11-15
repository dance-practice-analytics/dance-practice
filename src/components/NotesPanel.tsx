import { useStudio } from '../state/studio'
import { clock, useClockTime } from '../state/clock'
import { attemptAt, phaseAt } from '../lib/attempts'
import { formatTime } from '../lib/format'

function AddMoment() {
  const { dispatch } = useStudio()
  const now = useClockTime()
  return (
    <button className="btn btn-ghost" onClick={() => dispatch({ type: 'addMarker', t: now, text: '', author: 'dancer' })}>
      + Add a moment at {formatTime(now)}
    </button>
  )
}

export function NotesPanel() {
  const { state, dispatch } = useStudio()

  return (
    <div className="panel notes-panel">
      <div className="panel-head">
        <div>
          <div className="panel-title">Moments and reflection</div>
          <div className="panel-sub">Press M while watching to mark a moment.</div>
        </div>
      </div>
      <ul className="moments">
        {state.markers.length === 0 && <li className="empty">No moments yet.</li>}
        {state.markers.map((m) => {
          const att = attemptAt(state.attempts, m.t)
          const ph = phaseAt(att, m.t)
          return (
            <li key={m.id} className={m.author === 'companion' ? 'by-companion' : ''}>
              <button className="time-chip" onClick={() => clock.seek(m.t)} title="Go to this moment">
                {formatTime(m.t)}
              </button>
              <div className="moment-body">
                <small>
                  {att ? `Attempt ${att.index}${ph ? ` · ${ph.label}` : ''}` : 'Between attempts'}
                  {m.author === 'companion' && ' · added by companion'}
                </small>
                <input
                  value={m.text}
                  placeholder="What did you notice or feel here?"
                  onChange={(e) => dispatch({ type: 'updateMarker', id: m.id, text: e.target.value })}
                  aria-label={`Note at ${formatTime(m.t)}`}
                />
              </div>
              <button className="icon-btn small" onClick={() => dispatch({ type: 'removeMarker', id: m.id })} aria-label="Remove moment" title="Remove">
                ×
              </button>
            </li>
          )
        })}
      </ul>
      <AddMoment />
      <label className="reflection">
        <span>Session reflection</span>
        <textarea
          value={state.reflection}
          rows={4}
          placeholder="Which attempt felt closest to your goal? What will you try next time, or ask your teacher?"
          onChange={(e) => dispatch({ type: 'setReflection', text: e.target.value })}
        />
      </label>
      <div className="notes-finish">
        <button className="btn btn-primary" onClick={() => dispatch({ type: 'setReflectOpen', open: true })}>Finish &amp; reflect →</button>
      </div>
    </div>
  )
}
