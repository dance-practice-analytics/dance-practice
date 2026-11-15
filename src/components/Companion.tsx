import { useEffect, useRef, useState } from 'react'
import type { UIAction } from '../companion/actions'
import { reply, SUGGESTIONS, type CompanionReply } from '../companion/mockCompanion'
import { useStudio } from '../state/studio'
import { formatTime } from '../lib/format'

interface Message {
  id: number
  role: 'user' | 'assistant'
  text: string
  shown: number
  actions: UIAction[]
  lookedAt: string[]
}

let seq = 0

export function Companion() {
  const studio = useStudio()
  const { results, state, dispatch, summary, releve, apply, attemptById, metric } = studio
  const [messages, setMessages] = useState<Message[]>([])
  const [draft, setDraft] = useState('')
  const listRef = useRef<HTMLDivElement>(null)
  const typing = messages.some((m) => m.shown < m.text.length)

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
  }, [messages])

  // Reveal the newest answer a few characters at a time, the way a streamed reply arrives.
  useEffect(() => {
    const pending = messages.find((m) => m.shown < m.text.length)
    if (!pending) return
    const id = window.setTimeout(() => {
      const shown = Math.min(pending.text.length, pending.shown + 6)
      setMessages((ms) => ms.map((m) => (m.id === pending.id ? { ...m, shown } : m)))
      if (shown === pending.text.length) pending.actions.forEach(apply)
    }, 16)
    return () => window.clearTimeout(id)
  }, [messages, apply])

  const ask = (question: string) => {
    const q = question.trim()
    if (!q || typing) return
    const r: CompanionReply = reply(q, { results, attempts: state.attempts, summary, releve, markers: state.markers, focusMetric: state.focusMetric })
    setMessages((ms) => [
      ...ms,
      { id: ++seq, role: 'user', text: q, shown: q.length, actions: [], lookedAt: [] },
      { id: ++seq, role: 'assistant', text: r.text, shown: 0, actions: r.actions, lookedAt: r.lookedAt },
    ])
    setDraft('')
  }

  const describe = (a: UIAction) => {
    switch (a.type) {
      case 'seek_video':
        return `▶ Moved video to ${formatTime(a.t)}`
      case 'focus_metric':
        return `◎ Focus: ${metric(a.metricId).name}`
      case 'open_comparison':
        return `⇆ Opened attempt ${attemptById(a.a).index} vs ${attemptById(a.b).index}`
      case 'add_moment_marker':
        return `◆ Marked ${formatTime(a.t)}`
    }
  }

  return (
    <aside className="companion" aria-label="Practice companion">
      <div className="companion-head">
        <div>
          <div className="panel-title">✦ Practice companion</div>
          <div className="panel-sub">Prototype with scripted answers. No AI is connected yet.</div>
        </div>
        <button className="icon-btn" onClick={() => dispatch({ type: 'toggleCompanion' })} aria-label="Close companion">×</button>
      </div>
      <p className="companion-note">
        It answers only from this session's measurements and can move the video for you. It doesn't grade technique or give medical advice. In the
        real build it runs on Claude through the DAD server, which sends derived numbers and your notes, never video or names.
      </p>
      <div className="companion-list" ref={listRef}>
        {messages.length === 0 && (
          <div className="companion-empty">
            <b>Ask about your own attempts.</b>
            <span>Try one of these:</span>
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`msg msg-${m.role}`}>
            <div className="msg-text">{m.text.slice(0, m.shown)}</div>
            {m.role === 'assistant' && m.shown === m.text.length && (m.actions.length > 0 || m.lookedAt.length > 0) && (
              <div className="msg-meta">
                {m.actions.map((a, i) => (
                  <button key={i} className="action-chip" onClick={() => apply(a)} title={`Tool call: ${a.type}`}>
                    {describe(a)}
                  </button>
                ))}
                {m.lookedAt.length > 0 && <span className="looked">read: {m.lookedAt.join(', ')}</span>}
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="suggestions">
        {SUGGESTIONS.map((s) => (
          <button key={s} className="suggestion" onClick={() => ask(s)} disabled={typing}>
            {s}
          </button>
        ))}
      </div>
      <form
        className="companion-input"
        onSubmit={(e) => {
          e.preventDefault()
          ask(draft)
        }}
      >
        <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Ask about your practice…" aria-label="Message the companion" />
        <button className="btn btn-primary" disabled={!draft.trim() || typing}>Send</button>
      </form>
    </aside>
  )
}
