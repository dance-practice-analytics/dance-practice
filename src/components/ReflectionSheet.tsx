// End-of-session reflection, inside the workspace: what changed between the two
// attempts being compared (in neutral words), the dancer's moments, a free
// reflection and the goal for next time.

import { useState } from 'react'
import { useStudio } from '../state/studio'
import { api } from '../api/client'
import { navigate } from '../router'
import { toast } from '../state/app'
import { clock } from '../state/clock'
import { describeChange, formatTime, formatValue } from '../lib/format'
import { attemptAt, phaseAt } from '../lib/attempts'
import { PHASE_LABEL } from '../lib/phases'
import { track } from '../study/log'
import { Dialog } from './ui'

const PROMPTS = ['Which attempt felt closest to my goal?', 'What felt different in that one?', 'What surprised me in the measurements?', 'What will I ask my teacher?']

export function ReflectionSheet() {
  const { results, state, dispatch, summary, releve, attemptById } = useStudio()
  const [saving, setSaving] = useState(false)
  const close = () => dispatch({ type: 'setReflectOpen', open: false })
  const a = attemptById(state.compare.a)
  const b = attemptById(state.compare.b)
  const phase = state.compare.phase
  const viewsDiffer = a.context.view !== b.context.view

  const lines = results.metrics.map((m) => {
    const sa = summary(a.id, phase, m.id)
    const sb = summary(b.id, phase, m.id)
    if (viewsDiffer) return { m, text: 'not compared: different camera views' }
    if (!sa.available || !sb.available) return { m, text: (sa.available ? sb.reason : sa.reason) ?? 'unavailable' }
    return { m, text: `${formatValue(sa.mean, m)} → ${formatValue(sb.mean, m)}`, change: `B is ${describeChange(sa.mean!, sb.mean!, m)}` }
  })

  const addPrompt = (p: string) => dispatch({ type: 'setReflection', text: `${state.reflection.trim() ? `${state.reflection.trim()}\n\n` : ''}${p} ` })

  const finish = async () => {
    setSaving(true)
    try {
      await api.patchSession(results.session.id, { goal: state.goal, notes: { moments: state.markers, reflection: state.reflection, nextGoal: state.nextGoal } })
      track('reflect.finished', { moments: state.markers.length, reflectionLength: state.reflection.length, nextGoal: state.nextGoal.length > 0 })
      toast('Session saved to your journal.')
      close()
      navigate({ name: 'journal' })
    } catch {
      toast('Couldn’t save just now. Your writing is still here; try again.')
      setSaving(false)
    }
  }

  return (
    <Dialog open={state.reflectOpen} onClose={close} title="Finish and reflect" wide>
      <div className="reflect">
        <section>
          <h3>What you compared</h3>
          <p className="muted small">
            <span className="tag-a">A · attempt {a.index}</span> and <span className="tag-b">B · attempt {b.index}</span>, averages during {PHASE_LABEL[phase].toLowerCase()}. Change only; you decide what it means.
          </p>
          <ul className="reflect-facts">
            {lines.map(({ m, text, change }) => (
              <li key={m.id}><b>{m.name}</b><span>{text}</span>{change && <em>{change}</em>}</li>
            ))}
            <li>
              <b>Time on relevé</b>
              <span>{releve[a.id] === null || releve[b.id] === null ? 'unavailable: tracking gap' : `${releve[a.id]!.toFixed(1)} s → ${releve[b.id]!.toFixed(1)} s`}</span>
            </li>
          </ul>
        </section>

        <section>
          <h3>Your moments</h3>
          {state.markers.length === 0 && <p className="muted small">No moments marked. Press M while watching to mark one.</p>}
          <ul className="reflect-moments">
            {state.markers.map((mk) => {
              const att = attemptAt(state.attempts, mk.t)
              const ph = phaseAt(att, mk.t)
              return (
                <li key={mk.id}>
                  <button className="time-chip" onClick={() => { close(); clock.seek(mk.t) }} title="Go to this moment">{formatTime(mk.t)}</button>
                  <label>
                    <small>{att ? `Attempt ${att.index}${ph ? ` · ${ph.label}` : ''}` : 'Between attempts'}</small>
                    <input value={mk.text} placeholder={`What did you notice at ${formatTime(mk.t)}?`} onChange={(e) => dispatch({ type: 'updateMarker', id: mk.id, text: e.target.value })} />
                  </label>
                </li>
              )
            })}
          </ul>
        </section>

        <section>
          <h3>Reflection</h3>
          <div className="goal-ideas">
            {PROMPTS.map((p) => <button key={p} className="suggestion" onClick={() => addPrompt(p)}>{p}</button>)}
          </div>
          <textarea className="reflect-text" rows={5} value={state.reflection} onChange={(e) => dispatch({ type: 'setReflection', text: e.target.value })} placeholder="In your own words…" aria-label="Session reflection" />
        </section>

        <section>
          <h3>Next time I’ll focus on</h3>
          <input className="goal-input next-goal" value={state.nextGoal} onChange={(e) => dispatch({ type: 'setNextGoal', text: e.target.value })} placeholder={state.goal} aria-label="Goal for next session" />
          <p className="muted small">It shows on your home page when you come back.</p>
        </section>

        <div className="reflect-actions">
          <button className="btn" onClick={close}>Keep reviewing</button>
          <button className="btn btn-primary btn-lg" onClick={finish} disabled={saving}>{saving ? 'Saving…' : 'Save to journal'}</button>
        </div>
      </div>
    </Dialog>
  )
}
