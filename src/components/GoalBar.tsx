import { useState } from 'react'
import { useStudio } from '../state/studio'
import { MetricIcon } from './MetricIcon'

/** Workspace header row: today's goal, the focus measurement and the mode. */
export function GoalBar() {
  const { results, state, dispatch } = useStudio()
  const [editing, setEditing] = useState(false)

  return (
    <section className="goal-bar">
      <div className="goal">
        <span className="goal-kicker">Goal</span>
        {editing ? (
          <input
            className="goal-input"
            autoFocus
            value={state.goal}
            onChange={(e) => dispatch({ type: 'setGoal', text: e.target.value })}
            onBlur={() => setEditing(false)}
            onKeyDown={(e) => e.key === 'Enter' && setEditing(false)}
          />
        ) : (
          <button className="goal-text" onClick={() => setEditing(true)} title="Edit your goal">
            {state.goal || 'Add a goal'} <span className="goal-edit" aria-hidden="true">✎</span>
          </button>
        )}
      </div>
      <div className="focus-picker" role="group" aria-label="Focus measurement">
        <span className="goal-kicker">Focus</span>
        {results.metrics.map((m) => (
          <button key={m.id} className={`focus-chip ${state.focusMetric === m.id ? 'on' : ''}`} onClick={() => dispatch({ type: 'focusMetric', metricId: m.id })} title={m.question}>
            <MetricIcon id={m.id} />
            <span>{m.name}</span>
          </button>
        ))}
      </div>
      <div className="mode-switch" role="tablist" aria-label="Mode">
        <button role="tab" aria-selected={state.mode === 'review'} className={state.mode === 'review' ? 'on' : ''} onClick={() => dispatch({ type: 'setMode', mode: 'review' })}>Review</button>
        <button role="tab" aria-selected={state.mode === 'compare'} className={state.mode === 'compare' ? 'on' : ''} onClick={() => dispatch({ type: 'setMode', mode: 'compare' })}>Compare A/B</button>
      </div>
    </section>
  )
}
