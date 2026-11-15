// Screen 11 — Ask AI.
// Design: Chat.dc.html, ChatMobile.dc.html.
// The assistant has no service behind it in the prototype (the MT-2 plan only has the
// generate-feedback function), so this is the designed screen as a shell: the context
// panel shows the real measurements a question would be about, and the composer is
// there but cannot send. No conversation is faked and nothing is shared.

import { useMemo, useState } from 'react'
import { AI_CONSENT_SCOPE } from '../../feedback/client'
import { ConfBadge, EmptyState, ErrorAlert, Icon, NoteBox, PageHeader, SkeletonList } from '../components'
import { useConsents } from '../consents'
import { latestProcessed, useAttempts, type AttemptView } from '../data'
import { formatDate, MOVEMENT_LABELS, VIEW_LABELS } from '../format'
import { href, navigate, useRoute } from '../router'
import { useIsNarrow } from '../useIsNarrow'
import { chatContext, suggestedQuestions, type ChatContext, type ChatScope } from './chat/model'
import { AttemptPicker } from './notes/AttemptPicker'
import { attemptDay, attemptLine, attemptTitle } from './notes/model'
import './chat/chat.css'

const NOT_CONNECTED_ID = 'chat-not-connected'

export function Chat() {
  const route = useRoute()
  const attempts = useAttempts()
  const narrow = useIsNarrow()
  const [scope, setScope] = useState<ChatScope>('attempt')
  const routeId = route.name === 'chat' ? route.attemptId : undefined

  const all = attempts.data
  const attempt = useMemo(
    () => (routeId ? (all?.find((a) => a.id === routeId) ?? null) : latestProcessed(all)),
    [all, routeId],
  )
  const context = useMemo(() => (attempt && all ? chatContext(attempt, all, scope) : null), [attempt, all, scope])
  const questions = useMemo(() => (attempt && all ? suggestedQuestions(attempt, all) : []), [attempt, all])
  const pick = (attemptId: string) => navigate({ name: 'chat', attemptId })

  if (attempts.loading || !all) {
    return (
      <>
        <PageHeader title="Ask AI" />
        {attempts.error ? <ErrorAlert error={attempts.error} onRetry={attempts.refetch} /> : <SkeletonList label="Loading Ask AI" />}
      </>
    )
  }

  if (!attempt || !context) {
    const missing = Boolean(routeId)
    return (
      <>
        <PageHeader title="Ask AI" subtitle="Questions about one attempt, answered from its metrics only." />
        {attempts.error && <ErrorAlert error={attempts.error} onRetry={attempts.refetch} />}
        {missing && latestProcessed(all) && <AttemptPicker id="chat-attempt" attempts={all} value={null} onChange={pick} />}
        <EmptyState
          icon="chat"
          title={missing ? 'That attempt is no longer here' : 'No attempt to ask about yet'}
          action={
            <a className="btn btn-secondary" href={href({ name: 'library' })}>
              Open library
            </a>
          }
        >
          {missing
            ? 'It may have been deleted, or it belongs to another account. Pick another attempt.'
            : 'Pick a processed attempt first. Only its metric values would be shared — never video, images or keypoints.'}
        </EmptyState>
      </>
    )
  }

  const reviewHref = href({ name: 'review', attemptId: attempt.id })
  const metricsTag = <span className="tag">Metrics only</span>

  return (
    <>
      <PageHeader
        title="Ask AI"
        eyebrow={narrow ? attemptLine(attempt) : undefined}
        subtitle="Questions about one attempt, answered from its metrics only."
        backHref={reviewHref}
        mobileActions={metricsTag}
      />
      {attempts.error && <ErrorAlert error={attempts.error} onRetry={attempts.refetch} />}

      {narrow ? (
        <>
          <MobileContext context={context} />
          <AttemptPicker id="chat-attempt" attempts={all} value={attempt.id} onChange={pick} label="Asking about" />
          <Conversation attempt={attempt} questions={questions} narrow />
        </>
      ) : (
        <div className="v2-chat-cols">
          <ContextPanel attempt={attempt} all={all} context={context} scope={scope} setScope={setScope} onPick={pick} reviewHref={reviewHref} />
          <Conversation attempt={attempt} questions={questions} />
        </div>
      )}
    </>
  )
}

interface ContextPanelProps {
  attempt: AttemptView
  all: readonly AttemptView[]
  context: ChatContext
  scope: ChatScope
  setScope(s: ChatScope): void
  onPick(attemptId: string): void
  reviewHref: string
}

/** What the AI would see — and what it never would. */
function ContextPanel({ attempt, all, context, scope, setScope, onPick, reviewHref }: ContextPanelProps) {
  const consents = useConsents()
  const s = attempt.session
  return (
    <aside className="v2-chat-aside" aria-labelledby="chat-ctx-h">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <p className="t-label">Asking about</p>
        <h2 className="t-h2" id="chat-ctx-h">
          {attemptTitle(attempt)} · {MOVEMENT_LABELS[s.movement_type]}
        </h2>
        <p className="t-small muted">
          {s.title ? `${s.title} · ` : ''}
          {formatDate(attemptDay(attempt))}
          {s.camera_view ? ` · ${VIEW_LABELS[s.camera_view].toLowerCase()}` : ''} · <a href={reviewHref}>Open in review</a>
        </p>
      </div>
      <AttemptPicker id="chat-attempt" attempts={all} value={attempt.id} onChange={onPick} />
      <div className="seg" role="radiogroup" aria-label="Scope of metrics shared" style={{ width: '100%' }}>
        {(['attempt', 'session'] as const).map((v) => (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={scope === v}
            className={scope === v ? 'on' : undefined}
            onClick={() => setScope(v)}
            style={{ flex: 1, justifyContent: 'center' }}
          >
            {v === 'attempt' ? 'This attempt' : 'This session'}
          </button>
        ))}
      </div>
      <section className="card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }} aria-labelledby="chat-shared-h">
        <h2 className="t-h3" id="chat-shared-h">
          What would be shared with the AI
        </h2>
        <ul style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {context.rows.map((m) => (
            <li key={m.key} className="v2-chat-row">
              <span className="t-small" style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                <span style={{ fontWeight: 500 }}>{m.name}</span>
                <span className="subtle num" style={m.subdued ? { color: 'var(--text-3)' } : undefined}>
                  {m.value}
                </span>
              </span>
              <ConfBadge level={m.confidence} />
            </li>
          ))}
        </ul>
        <p className="t-caption">{context.note} Nothing is shared now: the assistant isn’t connected.</p>
      </section>
      <section className="well" style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <h2 className="t-small" style={{ fontWeight: 600, display: 'flex', gap: 8, alignItems: 'center' }}>
          <Icon name="device" size={16} />
          Never shared
        </h2>
        <p className="t-small muted">
          Video, images, keypoints, your name or email. The AI couldn’t see you dance — only the numbers above.
        </p>
      </section>
      {consents.status === 'ready' && !consents.has(AI_CONSENT_SCOPE) && (
        <p className="t-caption">
          AI features are turned off for your account. You can allow “AI practice notes (metrics only)” in{' '}
          <a href={href({ name: 'settings' })}>Settings</a>.
        </p>
      )}
    </aside>
  )
}

/** The phone's collapsible "N metrics shared" strip under the header. */
function MobileContext({ context }: { context: ChatContext }) {
  const [open, setOpen] = useState(false)
  const n = context.valueCount
  return (
    <>
      <button type="button" className="v2-chat-ctx" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls="chat-ctx-body">
        <Icon name="device" size={16} />
        <span className="t-small" style={{ flex: 1 }}>
          <span style={{ fontWeight: 600 }}>
            {n} {n === 1 ? 'metric' : 'metrics'} would be shared
          </span>{' '}
          · never video
        </span>
        <Icon name="chevron-down" size={16} style={{ color: 'var(--text-3)', transform: open ? 'rotate(180deg)' : 'none' }} />
      </button>
      {open && (
        <div className="v2-chat-ctx-body" id="chat-ctx-body">
          {context.rows.map((m) => (
            <div key={m.key} className="v2-chat-row">
              <span className="t-small" style={{ minWidth: 0 }}>
                {m.label} <span className="num subtle">{m.value}</span>
              </span>
              <ConfBadge level={m.confidence} />
            </div>
          ))}
          <p className="t-caption">Never shared: video, images, keypoints, name or email. Nothing is shared now.</p>
        </div>
      )}
    </>
  )
}

interface ConversationProps {
  attempt: AttemptView
  questions: readonly string[]
  narrow?: boolean
}

function Conversation({ attempt, questions, narrow }: ConversationProps) {
  return (
    <section className="card v2-chat-card" aria-labelledby="chat-h">
      {!narrow && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 20px', borderBottom: '1px solid var(--line)', flexWrap: 'wrap' }}>
          <h2 className="t-h3" id="chat-h" style={{ flex: 1 }}>
            Ask AI
          </h2>
          <span className="tag">Metrics only</span>
          <button className="btn btn-ghost btn-sm" type="button" disabled aria-describedby={NOT_CONNECTED_ID}>
            New conversation
          </button>
        </div>
      )}
      {narrow && (
        <h2 className="v2-sr" id="chat-h">
          Conversation
        </h2>
      )}

      <div className="v2-chat-log" role="log" aria-label="Conversation">
        <div
          style={{
            margin: 'auto',
            maxWidth: 440,
            textAlign: 'center',
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
            alignItems: 'center',
            padding: narrow ? '16px 0' : '40px 0',
          }}
        >
          <div className="well" style={{ width: 56, height: 56, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 16 }}>
            <Icon name="chat" size={24} />
          </div>
          <h3 className="t-h3">Ask about this attempt’s measurements</h3>
          <p className="t-small muted">
            Answers would describe your metrics and point to which ones they used. The AI won’t grade your technique or give medical advice.
          </p>
          <div id={NOT_CONNECTED_ID} style={{ textAlign: 'left', width: '100%' }}>
            <NoteBox title="Not connected in this prototype.">
              Ask AI has no service behind it yet, so questions can’t be sent and nothing is shared. Practice notes, review and compare use the
              same measurements. <a href={href({ name: 'notes', attemptId: attempt.id })}>Open practice notes for this attempt</a>
            </NoteBox>
          </div>
        </div>
      </div>

      <div className="v2-chat-composer">
        <div className="v2-chat-chips" role="group" aria-label="Suggested questions">
          {questions.map((q) => (
            <button key={q} className="chip" type="button" disabled aria-describedby={NOT_CONNECTED_ID}>
              {q}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          <label htmlFor="chat-in" className="v2-sr">
            Ask a question about your measurements
          </label>
          {narrow ? (
            <input
              id="chat-in"
              className="input"
              placeholder="Ask about your measurements…"
              style={{ height: 48, flex: 1 }}
              disabled
              aria-describedby={NOT_CONNECTED_ID}
            />
          ) : (
            <textarea
              id="chat-in"
              className="input"
              rows={2}
              placeholder="Ask about your measurements…"
              style={{ height: 'auto', minHeight: 48, padding: 12, resize: 'none', flex: 1 }}
              disabled
              aria-describedby={NOT_CONNECTED_ID}
            />
          )}
          {narrow ? (
            <button className="btn btn-primary btn-icon btn-lg" type="button" aria-label="Send" disabled aria-describedby={NOT_CONNECTED_ID}>
              <Icon name="arrow-right" style={{ width: 18, height: 18 }} />
            </button>
          ) : (
            <button className="btn btn-primary" type="button" style={{ height: 48 }} disabled aria-describedby={NOT_CONNECTED_ID}>
              Send
            </button>
          )}
        </div>
        {narrow ? (
          <p className="t-caption" style={{ textAlign: 'center' }}>
            Not medical advice · metrics only · sending is off in this prototype
          </p>
        ) : (
          <p className="disclaimer">
            <Icon name="info" />
            Not medical advice. Answers would use your metrics only and can be wrong. Sending is off in this prototype.
          </p>
        )}
      </div>
    </section>
  )
}
